import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { embedTexts } from '@/lib/llm';
import { fetchRepoTree, fetchRawFile, isGithubConfigured } from '@/lib/github';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 知识库向量同步：拉取 GitHub 笔记 → 内容哈希增量 → 分块 → 向量化 → 写入 pgvector
const CHUNK_CHARS = 1200;

function chunkText(text: string): string[] {
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > CHUNK_CHARS && cur) {
      chunks.push(cur.trim());
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter((c) => c.length > 20).slice(0, 10); // 单篇最多 10 块，控制成本
}

export async function POST(req: NextRequest) {
  try {
    const owner = requireAdminEnv();
    if (!isGithubConfigured()) {
      return NextResponse.json({ error: '未配置 GITHUB_REPO（.env.local）' }, { status: 400 });
    }
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 10, 30);

    // 既有元数据（增量依据：content_hash）
    const { data: metas } = await supabaseAdmin
      .from('obsidian_metadata')
      .select('id, file_path, content_hash')
      .eq('user_id', owner);
    const byPath = new Map((metas ?? []).map((m) => [m.file_path, m]));

    const entries = await fetchRepoTree();
    let embeddedFiles = 0;
    let skipped = 0;
    let processed = 0;

    for (const entry of entries) {
      if (processed >= limit) break;
      processed++;
      const content = await fetchRawFile(entry.path);
      const hash = createHash('sha1').update(content).digest('hex');
      const existing = byPath.get(entry.path);
      if (existing && existing.content_hash === hash) {
        skipped++;
        continue;
      }

      // upsert 元数据，取回 note_id
      const { data: meta, error: metaErr } = await supabaseAdmin
        .from('obsidian_metadata')
        .upsert(
          { user_id: owner, file_path: entry.path, content_hash: hash },
          { onConflict: 'user_id,file_path' }
        )
        .select('id')
        .single();
      if (metaErr || !meta) throw new Error(`写入元数据失败：${metaErr?.message ?? 'unknown'}`);

      const chunks = chunkText(content);
      if (chunks.length === 0) {
        skipped++;
        continue;
      }
      const vectors = await embedTexts(chunks);

      // 旧向量清掉再写（内容已变更）
      await supabaseAdmin.from('knowledge_embeddings').delete().eq('note_id', meta.id);
      const { error: embErr } = await supabaseAdmin.from('knowledge_embeddings').insert(
        vectors.map((embedding) => ({ user_id: owner, note_id: meta.id, embedding }))
      );
      if (embErr) throw new Error(`写入向量失败：${embErr.message}`);
      embeddedFiles++;
    }

    return NextResponse.json({ ok: true, total: entries.length, processed, embeddedFiles, skipped });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
