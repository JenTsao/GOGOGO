import { NextRequest, NextResponse } from 'next/server';
import { embedTexts } from '@/lib/llm';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// 混合检索：关键词（ilike）+ 向量语义（pgvector rpc match_notes）合并去重排序
export async function POST(req: NextRequest) {
  try {
    const owner = requireAdminEnv();
    const { query, match_count: matchCount } = (await req.json()) as { query?: string; match_count?: number };
    const q = (query ?? '').trim();
    if (!q) return NextResponse.json({ error: '缺少 query' }, { status: 400 });
    const topN = Math.min(matchCount ?? 10, 20);

    interface Hit {
      noteId: string;
      filePath: string;
      similarity: number;
      keyword: boolean;
    }
    const hits = new Map<string, Hit>();

    // 关键词路与语义路相互独立，并行发出（原串行两段延迟相加，现取最大值）
    // 语义路内部 embed → rpc 是依赖关系，保持串行
    let semanticOk = true;
    const kwPromise = supabaseAdmin()
      .from('obsidian_metadata')
      .select('id, file_path')
      .eq('user_id', owner)
      .ilike('file_path', `%${q}%`)
      .limit(topN);
    const semanticPromise = (async () => {
      try {
        const [vec] = await embedTexts([q]);
        return await supabaseAdmin().rpc('match_notes', {
          query_embedding: JSON.stringify(vec), // PostgREST 以文本形式传入 vector 参数
          owner,
          match_count: topN,
        });
      } catch {
        semanticOk = false; // embedding 未配置或供应商失败时静默降级为纯关键词
        return null;
      }
    })();

    // 1) 关键词命中（路径匹配；RLS 由 service role 绕过，显式 user_id 过滤）
    const { data: kwRows } = await kwPromise;
    for (const row of kwRows ?? []) {
      hits.set(row.id, { noteId: row.id, filePath: row.file_path, similarity: 0.5, keyword: true });
    }

    // 2) 语义命中（双命中加权 0.1）
    const semRes = await semanticPromise;
    if (semRes) {
      if (semRes.error) throw new Error(semRes.error.message);
      for (const row of semRes.data as { note_id: string; file_path: string; similarity: number }[]) {
        const prev = hits.get(row.note_id);
        const sim = row.similarity + (prev ? 0.1 : 0); // 双命中加权
        hits.set(row.note_id, {
          noteId: row.note_id,
          filePath: row.file_path,
          similarity: Math.max(sim, prev?.similarity ?? 0),
          keyword: prev?.keyword ?? false,
        });
      }
    }

    const results = [...hits.values()].sort((a, b) => b.similarity - a.similarity).slice(0, topN);
    return NextResponse.json({ ok: true, semanticOk, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
