import { create } from 'zustand';
import { storage } from './storage';

// 自定义日期提醒（蓝皮书 reminders 表）：本地 MMKV 优先，经管理台 /api/reminders 云同步
export interface Reminder {
  id: string;
  date: string; // 本地日期 YYYY-MM-DD
  content: string;
}

interface ReminderState {
  reminders: Reminder[];
  addReminder: (date: string, content: string) => void;
  removeReminder: (id: string) => void;
  // 云同步：拉云端差集合并 → 全量镜像上传。删除取舍与 tasks 墓碑一致：后同步者胜。
  sync: (webApiUrl: string, accessKey: string) => Promise<void>;
}

const REMINDERS_KEY = 'reminders-snapshot';

function load(): Reminder[] {
  const raw = storage.getString(REMINDERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 写盘统一入口：MMKV 写失败（存储满/序列化异常）不中断 set，内存态本次仍生效
function persist(next: Reminder[]) {
  try {
    storage.set(REMINDERS_KEY, JSON.stringify(next));
  } catch {
    // 忽略，下次写盘重试
  }
}

// 本地时区日期串（toISOString 是 UTC，跨时区会错天）
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const useReminderStore = create<ReminderState>((set, get) => ({
  reminders: load(),
  addReminder: (date, content) =>
    set((s) => {
      const next = [...s.reminders, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date, content }];
      persist(next);
      return { reminders: next };
    }),
  removeReminder: (id) =>
    set((s) => {
      const next = s.reminders.filter((r) => r.id !== id);
      persist(next);
      return { reminders: next };
    }),
  sync: async (webApiUrl, accessKey) => {
    const base = `${webApiUrl.replace(/\/+$/, '')}/api/reminders`;
    const headers = { 'Content-Type': 'application/json', 'x-access-key': accessKey };
    const local = get().reminders;
    // 1) 拉云端：补进本地缺失的（其他设备添加的）
    try {
      const res = await fetch(base, { headers });
      if (res.ok) {
        const data = (await res.json()) as { reminders?: { id: string; date: string; content: string }[] };
        const sig = new Set(local.map((r) => `${r.date}|${r.content}`));
        const missing = (data.reminders ?? [])
          .filter((r) => !sig.has(`${r.date}|${r.content}`))
          .map((r) => ({ id: `c-${r.id}`, date: r.date, content: r.content }));
        if (missing.length > 0) {
          const merged = [...local, ...missing];
          persist(merged);
          set({ reminders: merged });
        }
      }
    } catch {
      return; // 网络不通：下次再同步
    }
    // 2) 全量镜像上传（此时本地已是并集，云端其余设备数据已并入）
    try {
      const latest = get().reminders;
      await fetch(base, {
        method: 'POST',
        headers,
        body: JSON.stringify({ items: latest.map((r) => ({ date: r.date, content: r.content })) }),
      });
    } catch {
      // 静默：拉取成功上传失败，下次重试
    }
  },
}));
