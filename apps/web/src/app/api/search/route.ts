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

    // 1) 关键词检索（路径匹配；RLS 由 service role 绕过，显式 user_id 过滤）
    const { data: kwRows } = await supabaseAdmin
      .from('obsidian_metadata')
      .select('id, file_path')
      .eq('user_id', owner)
      .ilike('file_path', `%${q}%`)
      .limit(topN);
    for (const row of kwRows ?? []) {
      hits.set(row.id, { noteId: row.id, filePath: row.file_path, similarity: 0.5, keyword: true });
    }

    // 2) 向量语义检索（embedding 未配置时静默降级为纯关键词）
    let semanticOk = true;
    try {
      const [vec] = await embedTexts([q]);
      const { data: semRows, error } = await supabaseAdmin.rpc('match_notes', {
        query_embedding: JSON.stringify(vec), // PostgREST 以文本形式传入 vector 参数
        owner,
        match_count: topN,
      });
      if (error) throw new Error(error.message);
      for (const row of semRows as { note_id: string; file_path: string; similarity: number }[]) {
        const prev = hits.get(row.note_id);
        const sim = row.similarity + (prev ? 0.1 : 0); // 双命中加权
        hits.set(row.note_id, {
          noteId: row.note_id,
          filePath: row.file_path,
          similarity: Math.max(sim, prev?.similarity ?? 0),
          keyword: prev?.keyword ?? false,
        });
      }
    } catch {
      semanticOk = false;
    }

    const results = [...hits.values()].sort((a, b) => b.similarity - a.similarity).slice(0, topN);
    return NextResponse.json({ ok: true, semanticOk, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
