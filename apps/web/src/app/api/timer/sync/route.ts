import { NextRequest, NextResponse } from 'next/server';
import { accessKeyFromRequest, getUserByAccessKey } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

interface SessionIn {
  duration?: unknown;
  endedAt?: unknown;
}

// POST /api/timer/sync { sessions: [{duration, endedAt}] }（header x-access-key）
// 专注会话「追加并集」同步：timer_sessions 为 append-only 流水，天然无写冲突。
// 服务端把客户端提交的会话中云端缺失的部分补插（按 duration+started_at 精确匹配去重），
// 返回全量会话；客户端再取差集补本地 → 双端收敛为同一集合。
export async function POST(req: NextRequest) {
  let body: { sessions?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const found = await getUserByAccessKey(accessKeyFromRequest(req));
  if (!found) return NextResponse.json({ error: '访问密钥无效' }, { status: 401 });
  const owner = found.userId;

  const sb = supabaseAdmin();
  const { data: cloud, error: selErr } = await sb
    .from('timer_sessions')
    .select('id, duration, started_at')
    .eq('user_id', owner)
    .order('started_at', { ascending: false })
    .limit(1000);
  if (selErr) return NextResponse.json({ error: `会话读取失败：${selErr.message}` }, { status: 500 });

  // 时间规整：脏数据（非法/空 started_at）会让 new Date().toISOString() 抛 RangeError，
  // 整轮同步直接 500，客户端永远收敛不了
  const toIso = (v: unknown): string | null => {
    const t = new Date(v as string).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };

  const existing = new Set(
    (cloud ?? []).map((r) => `${r.duration}|${toIso(r.started_at) ?? ''}`)
  );

  const incoming = (Array.isArray(body.sessions) ? (body.sessions as SessionIn[]) : [])
    .filter(
      (s): s is { duration: number; endedAt: string } =>
        typeof s.duration === 'number' && s.duration >= 5 && typeof s.endedAt === 'string'
    )
    .map((s) => ({ user_id: owner, duration: Math.round(s.duration), started_at: s.endedAt }));

  // 客户端时间同样要规整：非法 endedAt 会被原样写进 timestamptz 列导致整批 insert 失败
  const missing = incoming
    .map((s) => ({ ...s, started_at: toIso(s.started_at) }))
    .filter((s): s is { user_id: string; duration: number; started_at: string } =>
      s.started_at !== null && !existing.has(`${s.duration}|${s.started_at}`)
    );
  if (missing.length > 0) {
    const { error: insErr } = await sb.from('timer_sessions').insert(missing.slice(0, 500));
    if (insErr) return NextResponse.json({ error: `会话写入失败：${insErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: missing.length, sessions: cloud ?? [] });
}
