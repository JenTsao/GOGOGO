import { create } from 'zustand';
import { useSettingsStore } from './settingsStore';
import { storage } from './storage';

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
  syncTasks: () => Promise<void>; // 云端双向同步（并集合并 + 墓碑删除）
}

const TASKS_KEY = 'tasks-snapshot';
const HISTORY_KEY = 'task-day-stats';
const TOMBSTONES_KEY = 'task-tombstones'; // 删除墓碑：云同步时传播删除（上限 200 条滚动淘汰）

// 墓碑 = {content,status}：删除/状态迁移（swap/complete 产生旧状态行）都要记
function loadTombstones(): { content: string; status: string }[] {
  const raw = storage.getString(TOMBSTONES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addTombstone(content: string, status: string) {
  const list = [...loadTombstones().filter((t) => !(t.content === content && t.status === status)), { content, status }].slice(-200);
  storage.set(TOMBSTONES_KEY, JSON.stringify(list));
}

// 与 reminderStore.localDateStr 同逻辑；此处内联避免 store 模块间新增耦合
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

export const useTaskStore = create<TaskState>((set, get) => ({
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
      const removed = [...s.top3, ...s.backlog].find((t) => t.id === id);
      if (removed) addTombstone(removed.content, removed.status); // 删除随墓碑传播到云端
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
      // id 不在 top3（重复点击 / 任务已被移除）时必须放弃：否则会写入 id/content 均为 undefined 的幽灵任务并落盘
      if (!task) return {};
      // 墓碑记的是「迁移前云端那一行」的状态，写死 'top3' 会让 done 态旧行留在云端导致任务复活
      addTombstone(task.content, task.status);
      const top3 = s.top3.filter((t) => t.id !== id);
      const backlog = [...s.backlog, { ...task, status: 'backlog' as const }];
      persist(top3, backlog);
      const history = snapshotToday(top3, s.history);
      storage.set(HISTORY_KEY, JSON.stringify(history));
      return { top3, backlog, history };
    }),
  completeTask: (id) =>
    set((s) => {
      const task = s.top3.find((t) => t.id === id);
      if (task && task.status !== 'done') addTombstone(task.content, task.status);
      const top3 = s.top3.map((t) => (t.id === id ? { ...t, status: 'done' as const } : t));
      persist(top3, s.backlog);
      const history = snapshotToday(top3, s.history);
      storage.set(HISTORY_KEY, JSON.stringify(history));
      return { top3, history };
    }),
  // 云端双向同步：并集合并 + 墓碑删除（见 /api/tasks/sync 注释）。
  // 本地提交全池与墓碑 → 服务端合并 → 用返回的规范池（云端 id）重建本地。
  // 失败静默：本地不动，下次再同步。history 为本地派生数据，不参与云同步。
  syncTasks: async () => {
    const { webApiUrl, accessKey } = useSettingsStore.getState();
    if (!webApiUrl || !accessKey) return;
    const { top3, backlog } = get();
    const pool = [...top3, ...backlog].map((t) => ({
      content: t.content,
      subject: t.subject,
      status: t.status,
      date: t.date,
    }));
    try {
      const res = await fetch(`${webApiUrl.replace(/\/+$/, '')}/api/tasks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
        body: JSON.stringify({ tasks: pool, deletions: loadTombstones() }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { tasks?: { id: string; content: string; subject: string | null; status: string; date: string | null }[] };
      const cloud = data.tasks ?? [];
      // 规范池重建：backlog 归后备箱，top3/done 归三件事区（done 保留展示，与本地行为一致）
      const newTop3: Task[] = [];
      const newBacklog: Task[] = [];
      for (const t of cloud) {
        const task: Task = {
          id: t.id, // 用云端 id，跨端去重
          content: t.content,
          subject: t.subject ?? undefined,
          status: t.status as TaskStatus,
          date: t.date ?? undefined,
        };
        if (t.status === 'backlog') newBacklog.push(task);
        else newTop3.push(task);
      }
      // 竞态补偿：请求飞行期间新增/改动的本地任务既不在上传快照里、也不在云端返回中，
      // 直接用云端覆盖会让它们本地+云端同时消失。按服务端去重键 (status|content|date) 补回本地独有的增量。
      // 云端行的 date 是 string | null，本地是 string | undefined，键函数必须同时接受两者
      const keyOf = (t: { status: string; content: string; date?: string | null }) => `${t.status}|${t.content}|${t.date ?? ''}`;
      const cloudKeys = new Set(cloud.map(keyOf));
      const after = get(); // 取 await 之后的最新快照，不能用请求前的 pool
      for (const t of [...after.top3, ...after.backlog]) {
        if (cloudKeys.has(keyOf(t))) continue;
        if (t.status === 'backlog') newBacklog.push(t);
        else newTop3.push(t);
        cloudKeys.add(keyOf(t)); // 本地同键重复项只补一次
      }
      storage.set(TOMBSTONES_KEY, JSON.stringify([])); // 同步成功，清空墓碑
      persist(newTop3, newBacklog);
      const history = snapshotToday(newTop3, get().history);
      storage.set(HISTORY_KEY, JSON.stringify(history));
      set({ top3: newTop3, backlog: newBacklog, history });
    } catch {
      // 网络失败静默
    }
  },
}));
