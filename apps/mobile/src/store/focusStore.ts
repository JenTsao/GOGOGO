import { create } from 'zustand';

// 专注模型（心流）计时器状态
interface FocusState {
  running: boolean;
  seconds: number;
  start: () => void;
  stop: () => void;
  tick: () => void;
  reset: () => void;
}

export const useFocusStore = create<FocusState>((set) => ({
  running: false,
  seconds: 0,
  start: () => set({ running: true }),
  stop: () => set({ running: false }),
  tick: () => set((s) => ({ seconds: s.seconds + 1 })),
  reset: () => set({ running: false, seconds: 0 }),
}));
