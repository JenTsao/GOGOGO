import { create } from 'zustand';

// L4 级 AI 悬浮球状态（六大专属工具调度占位）
export type AiTool =
  | 'addTask'
  | 'setReminder'
  | 'searchWeb'
  | 'exportNote'
  | 'queryStats'
  | 'correctCode';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  tool?: AiTool;
}

interface AiState {
  visible: boolean;
  messages: AiMessage[];
  open: () => void;
  close: () => void;
  pushMessage: (m: AiMessage) => void;
  // TODO: Phase 2 接入 DeepSeek API，实现 L1-L3 对话
  // TODO: Phase 3 实现 L4 跨模块调度（工具调用 + 执行前确认卡片）
}

export const useAiStore = create<AiState>((set) => ({
  visible: false,
  messages: [],
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
}));
