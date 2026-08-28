import { create } from 'zustand';
import { chatWithLlm } from '@/lib/llm';
import { useSettingsStore } from './settingsStore';

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

// L1-L3 级对话：多轮上下文 + 人设系统提示（L4 工具调度在 Phase 3）
const SYSTEM_PROMPT =
  '你是「高考副驾驶」，一名陪伴高三学生备考的 AI 助手。要求：回答简洁、鼓励但不灌鸡汤；' +
  '学科问题给出清晰步骤；能识别用户想记录任务、查资料等意图时，提示可以使用对应功能（工具调度将在后续版本上线）。';

interface AiState {
  visible: boolean;
  status: AiStatus;
  messages: AiMessage[];
  open: () => void;
  close: () => void;
  setStatus: (s: AiStatus) => void;
  pushMessage: (m: AiMessage) => void;
  // 真实对话入口：驾驶舱「AI讲题」等入口可直接注入问题并触发请求
  ask: (content: string) => Promise<void>;
  // 业务动作：进入“生成中”忙碌状态，完成后切回“任务完成”（供错题本 / 编译输出等入口调用）
  runAction: (label: string, durationMs?: number) => void;
  // TODO: Phase 3 实现 L4 跨模块调度（工具调用 + 执行前确认卡片）
}

let actionTimer: ReturnType<typeof setTimeout> | null = null;

export const useAiStore = create<AiState>((set, get) => ({
  visible: false,
  status: 'idle',
  messages: [],
  open: () => set({ visible: true, status: 'listening' }),
  close: () => set({ visible: false, status: 'idle' }),
  setStatus: (status) => set({ status }),
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  ask: async (content) => {
    const text = content.trim();
    if (!text || get().status === 'thinking') return;
    get().pushMessage({ role: 'user', content: text });
    get().setStatus('thinking');
    const { llmBaseUrl, llmModel, llmApiKey } = useSettingsStore.getState();
    try {
      // 最近 12 条作为上下文（当前 user 消息已在 store 中）
      const history = [...get().messages.slice(-12)].map((m) => ({ role: m.role, content: m.content }));
      const reply = await chatWithLlm(
        { baseUrl: llmBaseUrl, apiKey: llmApiKey, model: llmModel },
        [{ role: 'system', content: SYSTEM_PROMPT }, ...history]
      );
      get().pushMessage({ role: 'assistant', content: reply });
      get().setStatus('done');
    } catch (e) {
      get().pushMessage({ role: 'assistant', content: `请求失败：${(e as Error).message}` });
      get().setStatus('error');
    }
  },
  runAction: (label, durationMs = 1200) => {
    if (actionTimer) clearTimeout(actionTimer);
    set((s) => ({
      status: 'generating',
      messages: [...s.messages, { role: 'assistant', content: `开始${label}…` }],
    }));
    actionTimer = setTimeout(() => {
      set((s) => ({
        status: 'done',
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            content: `${label}已完成（Phase 2 接入真实引擎后产出 PDF / Anki / 大纲）。`,
          },
        ],
      }));
    }, durationMs);
  },
}));
