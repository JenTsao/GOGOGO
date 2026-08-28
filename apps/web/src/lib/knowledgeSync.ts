import { createHash } from 'node:crypto';
import { embedTexts } from '@/lib/llm';
import { fetchRepoTree, fetchRawFile, isGithubConfigured } from '@/lib/github';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';

// 知识库向量同步核心（手动按钮 /api/knowledge/sync 与定时任务 /api/cron/knowledge 共用）：
// 拉取 GitHub 笔记 → 内容哈希增量 → 分块 → 向量化 → 写入 pgvector + 标签提取
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

// 层级标签提取（语义检索中心标签树数据源）：
// 1) 正文行内标签 #数学/微积分/导数（兼容行尾多个标签）
// 2) Obsidian frontmatter tags: [a, b/c] 列表
export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  // frontmatter 区（文件开头 --- ... ---）内的 tags 行
  const fm = /^---\n([\s\S]*?)\n---/.exec(content.slice(0, 2000));
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^tags:\s*(.+)$/.exec(line.trim());
      if (m) {
        // 支持 [a, b/c] 与 a, b/c 两种写法
        const inner = m[1].replace(/^\[|\]$/g, '');
        for (const t of inner.split(',').map((s) => s.trim().replace(/^#/, ''))) {
          if (t) tags.add(t);
        }
      }
    }
  }
  // 正文行内标签：去代码块避免误提取；支持层级（数学/微积分/导数）与单级（重点）
  const body = content.replace(/```[\s\S]*?```/g, '');
  for (const m of body.matchAll(/(?:^|\s)#([\w\u4e00-\u9fa5/-]{2,})/g)) {
    tags.add(m[1]);
  }
  return [...tags].slice(0, 30); // 上限防异常文件污染
}

export interface SyncResult {
  total: number;
  processed: number;
  embeddedFiles: number;
  skipped: number;
}

// 每次调用最多处理 limit 篇（成本/时长控制）：哈希未变的跳过，因此多跑几轮即全量收敛
export async function syncKnowledge(limit: number): Promise<SyncResult> {
  const owner = requireAdminEnv();
  if (!isGithubConfigured()) {
    throw new Error('未配置 GITHUB_REPO（.env.local）');
  }

  // 既有元数据（增量依据：content_hash）
  const { data: metas } = await supabaseAdmin()
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

    // upsert 元数据（含标签提取），取回 note_id
    const { data: meta, error: metaErr } = await supabaseAdmin()
      .from('obsidian_metadata')
      .upsert(
        { user_id: owner, file_path: entry.path, content_hash: hash, tags: extractTags(content) },
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
    await supabaseAdmin().from('knowledge_embeddings').delete().eq('note_id', meta.id);
    const { error: embErr } = await supabaseAdmin().from('knowledge_embeddings').insert(
      vectors.map((embedding) => ({ user_id: owner, note_id: meta.id, embedding }))
    );
    if (embErr) throw new Error(`写入向量失败：${embErr.message}`);
    embeddedFiles++;
  }

  return { total: entries.length, processed, embeddedFiles, skipped };
}
