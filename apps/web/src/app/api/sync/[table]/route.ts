import { NextRequest, NextResponse } from 'next/server';
import { accessKeyFromRequest, getUserByAccessKey } from '@/lib/access';
import { batchUpsert, pull, softDelete, type SyncTableDef } from '@/lib/syncRepo';

export const dynamic = 'force-dynamic';

// 通用增量同步端点（03-通用增量同步仓库算法的 API 面）：
//   GET  /api/sync/{table}?since=ISO  → { rows, deletedIds, serverTime }（增量行 + 墓碑）
//   POST /api/sync/{table} { action: 'push',   rows: [...] } → { serverTime }
//   POST /api/sync/{table} { action: 'delete', ids:  [...] } → { serverTime }
// 表白名单：只有 SYNC_TABLES 注册过的表可用——列白名单（syncRepo）之上的第二道闸，
// 客户端无法通过 URL 触达未注册表。新表接入 = SYNC_TABLES 加一条 def。

const TASKS_DEF: SyncTableDef = {
  table: 'tasks',
  cols: {
    content: 'string',
    subject: 'string',
    status: 'string',
    date: 'date',
  },
};

const SYNC_TABLES: Record<string, SyncTableDef> = {
  tasks: TASKS_DEF,
};

async function resolveOwner(req: NextRequest): Promise<string | null> {
  const found = await getUserByAccessKey(accessKeyFromRequest(req));
  return found?.userId ?? null;
}

function tableFromName(name: string): SyncTableDef | null {
  return SYNC_TABLES[name] ?? null;
}

export async function GET(req: NextRequest, ctx: { params: { table: string } }) {
  const owner = await resolveOwner(req);
  if (!owner) return NextResponse.json({ error: '访问密钥无效' }, { status: 401 });
  const def = tableFromName(ctx.params.table);
  if (!def) return NextResponse.json({ error: '未注册的同步表' }, { status: 404 });

  const since = req.nextUrl.searchParams.get('since') ?? '';
  if (!since || Number.isNaN(Date.parse(since))) {
    return NextResponse.json({ error: '缺少合法的 since 游标（ISO 时间）' }, { status: 400 });
  }

  try {
    const { rows, deletedIds } = await pull(def, owner, since);
    return NextResponse.json({ rows, deletedIds, serverTime: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: { table: string } }) {
  const owner = await resolveOwner(req);
  if (!owner) return NextResponse.json({ error: '访问密钥无效' }, { status: 401 });
  const def = tableFromName(ctx.params.table);
  if (!def) return NextResponse.json({ error: '未注册的同步表' }, { status: 404 });

  let body: { action?: unknown; rows?: unknown; ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  try {
    if (body.action === 'push') {
      const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];
      const count = await batchUpsert(def, owner, rows);
      return NextResponse.json({ ok: true, pushed: count, serverTime: new Date().toISOString() });
    }
    if (body.action === 'delete') {
      const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(String) : [];
      const count = await softDelete(def, owner, ids);
      return NextResponse.json({ ok: true, deleted: count, serverTime: new Date().toISOString() });
    }
    return NextResponse.json({ error: '未知 action（push / delete）' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
