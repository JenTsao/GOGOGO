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

// 每日任务完成率快照（仪表盘趋势折线数据源；只积累、不回填历史）
export interface DayStat {
  date: string; // YYYY-MM-DD
  done: number;
  total: number;
}

interface TaskState {
  top3: Task[]; // 今日三件事
  backlog: Task[]; // 后备箱
  history: DayStat[]; // 近 30 天每日完成率快照
  addTask: (content: string, status?: 'top3' | 'backlog') => void;
  removeTask: (id: string) => void;
  swapWithBacklog: (id: string) => void;
  completeTask: (id: string) => void;
}

const TASKS_KEY = 'tasks-snapshot';
const HISTORY_KEY = 'task-day-stats';

// 与 reminderStore.localDateStr 同逻辑；此处内联避免循环依赖（reminderStore 依赖本模块的 storage）
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadHistory(): DayStat[] {
  const raw = storage.getString(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 任务池任何变化都刷新当日快照（完成数/总数），趋势线随积累自然成形
function snapshotToday(top3: Task[], history: DayStat[]): DayStat[] {
  const date = localDate(new Date());
  const stat: DayStat = {
    date,
    done: top3.filter((t) => t.status === 'done').length,
    total: top3.length,
  };
  return [...history.filter((h) => h.date !== date), stat].slice(-30);
}

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
  history: loadHistory(),
  addTask: (content, status = 'top3') =>
    set((s) => {
      const task: Task = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, content, status };
      const top3 = status === 'top3' ? [...s.top3, task] : s.top3;
      const backlog = status === 'backlog' ? [...s.backlog, task] : s.backlog;
      persist(top3, backlog);
      const history = snapshotToday(top3, s.history);
      storage.set(HISTORY_KEY, JSON.stringify(history));
      return { top3, backlog, history };
    }),
  removeTask: (id) =>
    set((s) => {
      const top3 = s.top3.filter((t) => t.id !== id);
      const backlog = s.backlog.filter((t) => t.id !== id);
      persist(top3, backlog);
      const history = snapshotToday(top3, s.history);
      storage.set(HISTORY_KEY, JSON.stringify(history));
      return { top3, backlog, history };
    }),
  swapWithBacklog: (id) =>
    set((s) => {
      const task = s.top3.find((t) => t.id === id);
      if (!task) return s;
      const top3 = s.top3.filter((t) => t.id !== id);
      const backlog = [...s.backlog, { ...task, status: 'backlog' as const }];
      persist(top3, backlog);
      const history = snapshotToday(top3, s.history);
      storage.set(HISTORY_KEY, JSON.stringify(history));
      return { top3, backlog, history };
    }),
  completeTask: (id) =>
    set((s) => {
      const top3 = s.top3.map((t) => (t.id === id ? { ...t, status: 'done' as const } : t));
      persist(top3, s.backlog);
      const history = snapshotToday(top3, s.history);
      storage.set(HISTORY_KEY, JSON.stringify(history));
      return { top3, history };
    }),
}));
