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

// AI 工作状态 → grok-ball 表情映射（emotionId 见 grok-ball 文档）
export type AiStatus =
  | 'idle' // 待机放空 02
  | 'receiving' // 接收任务 31
  | 'thinking' // 思考中 30
  | 'searching' // 检索资料 40（联网搜索中）
  | 'generating' // 处理中忙碌 32（生成错题本 / 编译 / 输出）
  | 'listening' // 等待输入 35
  | 'error' // 出错 34
  | 'done'; // 任务完成 33

// 状态 → grok-ball 表情 ID
export const STATUS_EMOTION: Record<AiStatus, string> = {
  idle: '02',
  receiving: '31',
  thinking: '30',
  searching: '40',
  generating: '32',
  listening: '35',
  error: '34',
  done: '33',
};

interface AiState {
  visible: boolean;
  status: AiStatus;
  messages: AiMessage[];
  open: () => void;
  close: () => void;
  setStatus: (s: AiStatus) => void;
  pushMessage: (m: AiMessage) => void;
  // TODO: Phase 2 接入 DeepSeek API，实现 L1-L3 对话
  // TODO: Phase 3 实现 L4 跨模块调度（工具调用 + 执行前确认卡片）
}

export const useAiStore = create<AiState>((set) => ({
  visible: false,
  status: 'idle',
  messages: [],
  open: () => set({ visible: true, status: 'listening' }),
  close: () => set({ visible: false, status: 'idle' }),
  setStatus: (status) => set({ status }),
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
}));
