// 通用增量同步仓库（算法移植自 MyWorkSpace 03-通用增量同步仓库，PHP/MySQL → TS/Supabase）
// 同步字段约定：id(PK, 客户端生成 UUID) / created_at / last_modified / is_deleted（约定列）+ 各表业务列（白名单）。
// 与 PHP 版的三处显式差异：
// 1. 隔离键：device_id → user_id（本项目单用户多设备收敛于同一账号，多设备互见而非隔离）；
// 2. 批量 upsert：MySQL ON DUPLICATE KEY → Supabase .upsert({ onConflict: 'id' })（同为单请求多行幂等）；
// 3. last_modified 一律服务端 now() 写入（PHP 版信任客户端时钟的 trade-off 在此修复——设备回拨不会漏拉）。
import { supabaseAdmin } from './supabaseAdmin';

export type SyncColType = 'string' | 'number' | 'boolean' | 'json' | 'stringArray' | 'date';

export interface SyncTableDef {
  table: string;
  /** 业务列白名单：列名与类型都来自这里——客户端无法注入白名单之外的列（注入免疫） */
  cols: Record<string, SyncColType>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 生成 RFC4122 v4 UUID（客户端未提供 id 时服务端补） */
function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
}

export function sanitizeRow(def: SyncTableDef, raw: Record<string, unknown>): Record<string, unknown> {
  // id：白名单之外 but 必备约定列——缺失即服务端生成，非字符串强转
  const out: Record<string, unknown> = {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 64) : uuid(),
  };
  // 业务列：白名单类型清洗（缺字段跳过——客户端载荷可少传，服务端补库默认值）
  for (const [col, type] of Object.entries(def.cols)) {
    if (!(col in raw)) continue;
    const v = raw[col];
    switch (type) {
      case 'number':
        out[col] = typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;
        break;
      case 'boolean':
        out[col] = v === true || v === 1 || v === '1';
        break;
      case 'json':
        out[col] = v && typeof v === 'object' ? v : null;
        break;
      case 'stringArray':
        out[col] = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
        break;
      case 'date':
        out[col] = typeof v === 'string' && DATE_RE.test(v) ? v : null;
        break;
      default:
        out[col] = typeof v === 'string' ? v : String(v ?? '');
    }
  }
  return out;
}

/**
 * 批量 upsert：单请求多行，按 id 冲突收敛（整行覆盖）。
 * user_id / last_modified / is_deleted 由服务端强制写入——客户端载荷不携带（权威归一）。
 */
export async function batchUpsert(
  def: SyncTableDef,
  owner: string,
  items: Record<string, unknown>[]
): Promise<number> {
  const rows = items.slice(0, 500).map((raw) => ({
    ...sanitizeRow(def, raw),
    user_id: owner,
    last_modified: new Date().toISOString(), // 服务端权威时钟
    is_deleted: false,
  }));
  if (rows.length === 0) return 0;
  const { error } = await supabaseAdmin().from(def.table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${def.table} 批量写入失败：${error.message}`);
  return rows.length;
}

/** 增量拉取：last_modified > since 的未删行（ASC 保证因果顺序）+ 已删墓碑 id 列表 */
export async function pull(
  def: SyncTableDef,
  owner: string,
  since: string
): Promise<{ rows: Record<string, unknown>[]; deletedIds: string[] }> {
  const sb = supabaseAdmin();
  const cols = ['id', 'created_at', 'last_modified', ...Object.keys(def.cols)];
  const { data, error } = await sb
    .from(def.table)
    .select(cols.join(', '))
    .eq('user_id', owner)
    .eq('is_deleted', false)
    .gt('last_modified', since)
    .order('last_modified', { ascending: true })
    .limit(1000); // 大批量分片上限：单响应可控
  if (error) throw new Error(`${def.table} 增量拉取失败：${error.message}`);

  const { data: tombs, error: tErr } = await sb
    .from(def.table)
    .select('id')
    .eq('user_id', owner)
    .eq('is_deleted', true)
    .gt('last_modified', since)
    .limit(1000);
  if (tErr) throw new Error(`${def.table} 墓碑拉取失败：${tErr.message}`);

  // supabase-js 未提供 schema 泛型时 select 返回哨兵类型，此处行结构由列白名单保证，双段断言收窄
  return { rows: (data ?? []) as unknown as Record<string, unknown>[], deletedIds: (tombs ?? []).map((t) => String(t.id)) };
}

/** 软删除（墓碑）：行保留 + 标记 + last_modified 推进——删除也是「变更」，随增量传播 */
export async function softDelete(def: SyncTableDef, owner: string, ids: string[]): Promise<number> {
  const clean = ids.filter((x) => typeof x === 'string' && x.trim()).slice(0, 500);
  if (clean.length === 0) return 0;
  const { error } = await supabaseAdmin()
    .from(def.table)
    .update({ is_deleted: true, last_modified: new Date().toISOString() })
    .eq('user_id', owner)
    .in('id', clean);
  if (error) throw new Error(`${def.table} 软删失败：${error.message}`);
  return clean.length;
}
