import { create } from 'zustand';
import { storage } from './taskStore';
import { useSettingsStore } from './settingsStore';

// 专注模型（心流）计时器状态；会话记录持久化 + 云端追加并集同步（timer_sessions）
export interface FocusSession {
  id: string;
  duration: number; // 秒
  endedAt: string; // ISO 时间
}

interface FocusState {
  running: boolean;
  seconds: number;
  sessions: FocusSession[];
  // 心流进行中 → 通知 handler 抑制横幅/声音（内存态，退出即失效，符合「当下屏蔽」语义）
  suppressNotifications: boolean;
  setSuppressNotifications: (v: boolean) => void;
  start: () => void;
  stop: () => void;
  tick: () => void;
  reset: () => void;
  syncSessions: () => Promise<void>; // 云端会话并集同步（append-only，无冲突）
}

const SESSIONS_KEY = 'focus-sessions';
const MAX_SESSIONS = 200; // 本地上限提到 200，与云端读取窗口一致

function loadSessions(): FocusSession[] {
  const raw = storage.getString(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const useFocusStore = create<FocusState>((set, get) => ({
  running: false,
  seconds: 0,
  sessions: loadSessions(),
  suppressNotifications: false,
  setSuppressNotifications: (v) => set({ suppressNotifications: v }),
  start: () => set({ running: true }),
  stop: () => {
    const { seconds, sessions } = get();
    if (seconds < 5) {
      set({ running: false, seconds: 0 });
      return;
    }
    const session: FocusSession = {
      id: `${Date.now()}`,
      duration: seconds,
      endedAt: new Date().toISOString(),
    };
    const next = [session, ...sessions].slice(0, MAX_SESSIONS);
    storage.set(SESSIONS_KEY, JSON.stringify(next));
    set({ running: false, seconds: 0, sessions: next });
  },
  tick: () => set((s) => ({ seconds: s.seconds + 1 })),
  reset: () => set({ running: false, seconds: 0 }),
  // 会话并集：本地全量提交 → 服务端按 (duration, started_at) 去重补插 → 返回云端全量 → 差集补本地。
  // append-only 流水，双端自然收敛；失败静默下次再试。
  syncSessions: async () => {
    const { webApiUrl, accessKey } = useSettingsStore.getState();
    if (!webApiUrl || !accessKey) return;
    try {
      const res = await fetch(`${webApiUrl.replace(/\/+$/, '')}/api/timer/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
        body: JSON.stringify({ sessions: get().sessions.map((s) => ({ duration: s.duration, endedAt: s.endedAt })) }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { sessions?: { duration: number; started_at: string }[] };
      const cloudSet = new Set(
        (data.sessions ?? []).map((s) => `${s.duration}|${new Date(s.started_at).toISOString()}`)
      );
      // 差集补本地：云端有而本地没有的会话（他端产生）
      const localSet = new Set(get().sessions.map((s) => `${s.duration}|${s.endedAt}`));
      const remote = (data.sessions ?? [])
        .filter((s) => !localSet.has(`${s.duration}|${new Date(s.started_at).toISOString()}`))
        .map((s, i) => ({
          id: `c-${Date.now()}-${i}`,
          duration: s.duration,
          endedAt: new Date(s.started_at).toISOString(),
        }));
      if (remote.length === 0) return;
      const merged = [...get().sessions, ...remote]
        .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
        .slice(0, MAX_SESSIONS);
      storage.set(SESSIONS_KEY, JSON.stringify(merged));
      set({ sessions: merged });
    } catch {
      // 网络失败静默
    }
  },
}));
