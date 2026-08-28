import { create } from 'zustand';
import { chatWithLlm, ChatMessage, imageTextContent } from '@/lib/llm';
import { TOOL_SCHEMAS, WRITE_TOOLS, executeTool, describeToolCall, AiToolName } from '@/lib/aiTools';
import { useSettingsStore } from './settingsStore';

// L4 级 AI 悬浮球状态（六大专属工具调度占位）
export type AiTool =
  | 'addTask'
  | 'setReminder'
  | 'searchWeb'
  | 'exportNote'
  | 'queryStats'
  | 'correctCode';

// 消息附带的工具调用（写操作待确认状态挂在消息上）
export interface PendingToolCall {
  id: string;
  name: AiToolName;
  args: Record<string, unknown>;
  state: 'pending' | 'confirmed' | 'cancelled';
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  tool?: AiTool;
  toolCall?: PendingToolCall;
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

// L1-L4 人设：简洁鼓励、学科给步骤、有工具就用
const SYSTEM_PROMPT =
  '你是「高考副驾驶」，一名陪伴高三学生备考的 AI 助手。要求：回答简洁、鼓励但不灌鸡汤；学科问题给出清晰步骤。' +
  '你可以调用工具：添加任务、创建日期提醒、联网搜索、导出笔记、查询专注统计、修复代码。' +
  '需要用户确认的写操作会先展示确认卡片，由系统处理；你只负责判断意图并调用工具。';

interface AiState {
  visible: boolean;
  status: AiStatus;
  messages: AiMessage[];
  open: () => void;
  close: () => void;
  setStatus: (s: AiStatus) => void;
  pushMessage: (m: AiMessage) => void;
  // 真实对话入口（L1-L4）：识别工具意图；写操作挂确认卡片，读操作直接执行
  ask: (content: string) => Promise<void>;
  // 视觉对话（错题图片讲解）：走独立视觉模型（GLM-4.6V-Flash 等），不传工具（视觉模型多不支持 function calling）
  askVision: (prompt: string, imageDataUrl: string) => Promise<void>;
  // 确认卡片：执行 / 取消
  confirmToolCall: (callId: string) => Promise<void>;
  cancelToolCall: (callId: string) => void;
  // 业务动作：进入“生成中”忙碌状态，完成后切回“任务完成”（供错题本 / 编译输出等入口调用）
  runAction: (label: string, durationMs?: number) => void;
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
      // 最近 12 条作为上下文（当前 user 消息已在 store 中；toolCall 元数据不进 LLM）
      const history: ChatMessage[] = [...get().messages.slice(-12)].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const reply = await chatWithLlm(
        { baseUrl: llmBaseUrl, apiKey: llmApiKey, model: llmModel },
        [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        { tools: TOOL_SCHEMAS }
      );

      if (reply.toolCalls.length > 0) {
        // 模型可能一次返回多个工具调用（如同时加任务+设提醒）：读操作依次执行，写操作各挂一张确认卡片
        if (reply.content) get().pushMessage({ role: 'assistant', content: reply.content });
        let pending = 0;
        let lastOk = true;
        for (const call of reply.toolCalls) {
          if (WRITE_TOOLS.has(call.name)) {
            pending++;
            get().pushMessage({
              role: 'assistant',
              content: `好的，我来${describeToolCall(call.name, call.args)}。`,
              toolCall: { id: call.id, name: call.name as AiToolName, args: call.args, state: 'pending' },
            });
          } else {
            const result = await executeTool(call.name, call.args);
            get().pushMessage({ role: 'assistant', content: result.text });
            if (!result.ok) lastOk = false;
          }
        }
        get().setStatus(pending > 0 ? 'listening' : lastOk ? 'done' : 'error');
        return;
      }

      if (!reply.content) throw new Error('模型返回为空');
      get().pushMessage({ role: 'assistant', content: reply.content });
      get().setStatus('done');
    } catch (e) {
      get().pushMessage({ role: 'assistant', content: `请求失败：${(e as Error).message}` });
      get().setStatus('error');
    }
  },
  // 视觉对话：错题图片直接喂给视觉模型（GLM-4.6V-Flash），讲解上屏悬浮球
  askVision: async (prompt, imageDataUrl) => {
    get().pushMessage({ role: 'user', content: `${prompt}\n📷（已附错题图片）` });
    get().setStatus('thinking');
    const { visionBaseUrl, visionApiKey, visionModel } = useSettingsStore.getState();
    try {
      // 文本历史照常携带（最近 6 条），最后一条 user 为「图片+文字」视觉消息
      const history: ChatMessage[] = get()
        .messages.slice(-7, -1)
        .map((m) => ({ role: m.role, content: m.content }));
      const reply = await chatWithLlm(
        { baseUrl: visionBaseUrl, apiKey: visionApiKey, model: visionModel },
        [
          { role: 'system', content: '你是「高考副驾驶」。用户发来一张错题图片，请：先读出题目关键条件，再给出分步解题过程，指出图中可见的作答错误（如有），最后给 1-2 个同类练习方向。回答简洁清晰，用中文。' },
          ...history,
          { role: 'user', content: imageTextContent(prompt, imageDataUrl) },
        ]
      );
      get().pushMessage({ role: 'assistant', content: reply.content });
      get().setStatus('done');
    } catch (e) {
      get().pushMessage({ role: 'assistant', content: `视觉讲解失败：${(e as Error).message}` });
      get().setStatus('error');
    }
  },
  confirmToolCall: async (callId) => {
    const msg = get().messages.find((m) => m.toolCall?.id === callId);
    if (!msg?.toolCall || msg.toolCall.state !== 'pending') return;
    // 先置为已确认（防止重复点击），再执行
    set((s) => ({
      messages: s.messages.map((m) =>
        m.toolCall?.id === callId ? { ...m, toolCall: { ...m.toolCall, state: 'confirmed' as const } } : m
      ),
    }));
    get().setStatus('generating');
    const { name, args } = msg.toolCall;
    const result = await executeTool(name, args);
    get().pushMessage({ role: 'assistant', content: result.text });
    get().setStatus(result.ok ? 'done' : 'error');
  },
  cancelToolCall: (callId) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.toolCall?.id === callId ? { ...m, toolCall: { ...m.toolCall, state: 'cancelled' as const } } : m
      ),
    }));
    get().pushMessage({ role: 'assistant', content: '好的，已取消该操作。' });
    get().setStatus('done');
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
            content: `${label}已完成（编译引擎上线后将产出 PDF / Anki / 大纲）。`,
          },
        ],
      }));
    }, durationMs);
  },
}));
