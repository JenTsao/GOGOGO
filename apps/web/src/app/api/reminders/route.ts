import { NextRequest, NextResponse } from 'next/server';
import { getUserByAccessKey } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// 自定义提醒云同步（x-access-key 鉴权，service role 绕过 RLS、显式按 user_id 过滤）
// GET：全量提醒（最多 500 条）；POST：全量镜像替换。
// 设计取舍：提醒条目小、无并发编辑场景，镜像替换避免墓碑/版本向量复杂度；
// 多端删除的「后同步者胜」取舍与 /api/tasks/sync 墓碑模型一致（见 AGENTS.md）。
export async function GET(req: NextRequest) {
  const user = await getUserByAccessKey(req.headers.get('x-access-key'));
  if (!user) return NextResponse.json({ error: '访问密钥无效或缺失' }, { status: 401 });
  const { data, error } = await supabaseAdmin()
    .from('reminders')
    .select('id, date, content')
    .eq('user_id', user.userId)
    .order('date')
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reminders: data });
}

export async function POST(req: NextRequest) {
  const user = await getUserByAccessKey(req.headers.get('x-access-key'));
  if (!user) return NextResponse.json({ error: '访问密钥无效或缺失' }, { status: 401 });
  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter(
      (r): r is { date: string; content: string } =>
        typeof r === 'object' && r !== null && typeof (r as { date?: unknown }).date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test((r as { date: unknown }).date as string) && typeof (r as { content?: unknown }).content === 'string'
    )
    .slice(0, 500)
    .map((r) => ({ user_id: user.userId, date: r.date, content: r.content.slice(0, 200) }));

  const sb = supabaseAdmin();
  const { error: delErr } = await sb.from('reminders').delete().eq('user_id', user.userId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  if (items.length > 0) {
    const { error: insErr } = await sb.from('reminders').insert(items);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: items.length });
}
