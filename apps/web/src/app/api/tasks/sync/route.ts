import { NextRequest, NextResponse } from 'next/server';
import { accessKeyFromRequest, getUserByAccessKey } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

interface TaskIn {
  content?: unknown;
  subject?: unknown;
  status?: unknown;
  date?: unknown;
}

interface Tombstone {
  content?: unknown;
  status?: unknown;
}

// POST /api/tasks/sync { tasks, deletions }（header x-access-key）
// 任务池双向同步 = 「并集合并 + 墓碑删除」：
// 1) 墓碑删除：先删掉各端显式删除过的 (content,status) 行
// 2) 并集插入：云端缺失的任务补插（按 content+status+date 去重，他端任务不丢）
// 3) 返回合并后的规范池（含服务端 id），双方重建本地即收敛
// 已知取舍：若 A 端删除后、B 端在拿到合并结果前又把同任务推上来会复活（无版本向量）；
// 单用户为主的现实下可接受，彻底方案是 Supabase Auth + updated_at 行级 LWW
export async function POST(req: NextRequest) {
  let body: { tasks?: unknown; deletions?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const found = await getUserByAccessKey(accessKeyFromRequest(req));
  if (!found) return NextResponse.json({ error: '访问密钥无效' }, { status: 401 });
  const owner = found.userId;

  const sb = supabaseAdmin();

  // ---------- 墓碑删除 ----------
  const tombs = (Array.isArray(body.deletions) ? (body.deletions as Tombstone[]) : [])
    .filter((t): t is { content: string; status: string } => typeof t.content === 'string' && typeof t.status === 'string')
    .slice(0, 200);
  const byStatus = new Map<string, string[]>();
  for (const t of tombs) {
    const status = ['backlog', 'top3', 'done'].includes(t.status) ? t.status : 'backlog';
    byStatus.set(status, [...(byStatus.get(status) ?? []), t.content.slice(0, 200)]);
  }
  for (const [status, contents] of byStatus) {
    await sb.from('tasks').delete().eq('user_id', owner).eq('status', status).in('content', contents);
  }

  // ---------- 并集插入 ----------
  const rows = (Array.isArray(body.tasks) ? (body.tasks as TaskIn[]) : [])
    .filter((t) => typeof t.content === 'string' && (t.content as string).trim().length > 0)
    .slice(0, 500)
    .map((t) => ({
      user_id: owner,
      content: String(t.content).trim().slice(0, 200),
      subject: typeof t.subject === 'string' ? t.subject.slice(0, 20) : null,
      status: t.status === 'top3' || t.status === 'done' ? t.status : 'backlog',
      date: typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null,
    }));

  const { data: existing, error: selErr } = await sb
    .from('tasks')
    .select('content, status, date')
    .eq('user_id', owner);
  if (selErr) return NextResponse.json({ error: `任务读取失败：${selErr.message}` }, { status: 500 });
  const existingKeys = new Set((existing ?? []).map((r) => `${r.status}|${r.content}|${r.date ?? ''}`));
  const missing = rows.filter((r) => !existingKeys.has(`${r.status}|${r.content}|${r.date ?? ''}`));
  if (missing.length > 0) {
    const { error: insErr } = await sb.from('tasks').insert(missing);
    if (insErr) return NextResponse.json({ error: `任务写入失败：${insErr.message}` }, { status: 500 });
  }

  // ---------- 返回规范池 ----------
  const { data, error: allErr } = await sb
    .from('tasks')
    .select('id, content, subject, status, date')
    .eq('user_id', owner)
    .order('created_at', { ascending: true });
  if (allErr) return NextResponse.json({ error: `任务读取失败：${allErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, tasks: data ?? [] });
}
