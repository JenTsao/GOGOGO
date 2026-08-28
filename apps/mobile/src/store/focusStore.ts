import { create } from 'zustand';
import { storage } from './taskStore';

// 专注模型（心流）计时器状态；会话记录持久化（Phase 3 接入 timer_sessions 云端表）
export interface FocusSession {
  id: string;
  duration: number; // 秒
  endedAt: string; // ISO 时间
}

interface FocusState {
  running: boolean;
  seconds: number;
  sessions: FocusSession[];
  start: () => void;
  stop: () => void;
  tick: () => void;
  reset: () => void;
}

const SESSIONS_KEY = 'focus-sessions';

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
    const next = [session, ...sessions].slice(0, 100);
    storage.set(SESSIONS_KEY, JSON.stringify(next));
    set({ running: false, seconds: 0, sessions: next });
  },
  tick: () => set((s) => ({ seconds: s.seconds + 1 })),
  reset: () => set({ running: false, seconds: 0 }),
}));
