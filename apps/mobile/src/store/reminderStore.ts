import { create } from 'zustand';
import { storage } from './storage';

// 自定义日期提醒（蓝皮书 reminders 表的本地版；Phase 3 同步云端，AI setReminder 工具写入此 store）
export interface Reminder {
  id: string;
  date: string; // 本地日期 YYYY-MM-DD
  content: string;
}

interface ReminderState {
  reminders: Reminder[];
  addReminder: (date: string, content: string) => void;
  removeReminder: (id: string) => void;
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

// 本地时区日期串（toISOString 是 UTC，跨时区会错天）
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const useReminderStore = create<ReminderState>((set) => ({
  reminders: load(),
  addReminder: (date, content) =>
    set((s) => {
      const next = [...s.reminders, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date, content }];
      storage.set(REMINDERS_KEY, JSON.stringify(next));
      return { reminders: next };
    }),
  removeReminder: (id) =>
    set((s) => {
      const next = s.reminders.filter((r) => r.id !== id);
      storage.set(REMINDERS_KEY, JSON.stringify(next));
      return { reminders: next };
    }),
}));
