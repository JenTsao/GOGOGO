import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';

// 本地缓存：会话、离线笔记、任务快照
export const storage = new MMKV({ id: 'gaokao-store' });

export type TaskStatus = 'backlog' | 'top3' | 'done';

export interface Task {
  id: string;
  content: string;
  subject?: string;
  status: TaskStatus;
  date?: string;
}

interface TaskState {
  top3: Task[]; // 今日三件事
  backlog: Task[]; // 后备箱
  addTask: (content: string, status?: 'top3' | 'backlog') => void;
  removeTask: (id: string) => void;
  swapWithBacklog: (id: string) => void;
  completeTask: (id: string) => void;
}

const TASKS_KEY = 'tasks-snapshot';

function load(): { top3: Task[]; backlog: Task[] } {
  const raw = storage.getString(TASKS_KEY);
  if (!raw) return { top3: [], backlog: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      top3: Array.isArray(parsed.top3) ? parsed.top3 : [],
      backlog: Array.isArray(parsed.backlog) ? parsed.backlog : [],
    };
  } catch {
    return { top3: [], backlog: [] };
  }
}

function persist(top3: Task[], backlog: Task[]) {
  storage.set(TASKS_KEY, JSON.stringify({ top3, backlog }));
}

const initial = load();

export const useTaskStore = create<TaskState>((set) => ({
  top3: initial.top3,
  backlog: initial.backlog,
  addTask: (content, status = 'top3') =>
    set((s) => {
      const task: Task = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, content, status };
      const top3 = status === 'top3' ? [...s.top3, task] : s.top3;
      const backlog = status === 'backlog' ? [...s.backlog, task] : s.backlog;
      persist(top3, backlog);
      return { top3, backlog };
    }),
  removeTask: (id) =>
    set((s) => {
      const top3 = s.top3.filter((t) => t.id !== id);
      const backlog = s.backlog.filter((t) => t.id !== id);
      persist(top3, backlog);
      return { top3, backlog };
    }),
  swapWithBacklog: (id) =>
    set((s) => {
      const task = s.top3.find((t) => t.id === id);
      if (!task) return s;
      const top3 = s.top3.filter((t) => t.id !== id);
      const backlog = [...s.backlog, { ...task, status: 'backlog' as const }];
      persist(top3, backlog);
      return { top3, backlog };
    }),
  completeTask: (id) =>
    set((s) => {
      const top3 = s.top3.map((t) => (t.id === id ? { ...t, status: 'done' as const } : t));
      persist(top3, s.backlog);
      return { top3 };
    }),
}));
