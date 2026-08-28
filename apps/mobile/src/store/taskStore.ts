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
  addTask: (content: string, status?: TaskStatus) => void;
  swapWithBacklog: (id: string) => void;
  completeTask: (id: string) => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  top3: [],
  backlog: [],
  addTask: (content, status = 'top3') =>
    set((s) => {
      const task: Task = { id: Date.now().toString(), content, status };
      return status === 'top3'
        ? { top3: [...s.top3, task] }
        : { backlog: [...s.backlog, task] };
    }),
  swapWithBacklog: (id) =>
    set((s) => {
      const t = s.top3.find((x) => x.id === id);
      if (!t) return s;
      t.status = 'backlog';
      return {
        top3: s.top3.filter((x) => x.id !== id),
        backlog: [...s.backlog, t],
      };
    }),
  completeTask: (id) =>
    set((s) => ({
      top3: s.top3.map((x) =>
        x.id === id ? { ...x, status: 'done' } : x
      ),
    })),
}));
