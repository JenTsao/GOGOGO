import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET /api/github/versions?path=xxx → 该笔记的版本快照列表（最新在前，含全文供一键回滚）
export async function GET(req: NextRequest) {
  const owner = process.env.OWNER_USER_ID;
  if (!owner) return NextResponse.json({ error: '未配置 OWNER_USER_ID' }, { status: 400 });
  const path = req.nextUrl.searchParams.get('path');
  if (!path) return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
  try {
    const sb = supabaseAdmin();
    const { data: meta, error } = await sb
      .from('obsidian_metadata')
      .select('version_history')
      .eq('user_id', owner)
      .eq('file_path', path)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const history = (meta?.version_history as { ts: string; content: string }[]) ?? [];
    return NextResponse.json({
      entries: history
        .slice()
        .reverse()
        .map((v) => ({ ts: v.ts, size: v.content.length, content: v.content })),
    });
  } catch (e) {
    return NextResponse.json({ error: `读取版本历史失败：${(e as Error).message}` }, { status: 502 });
  }
}
