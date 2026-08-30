import { create } from 'zustand';
import { Audio, AVPlaybackStatus } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { chatWithLlmStream, ChatMessage, imageTextContent } from '@/lib/llm';
import { TOOL_SCHEMAS, WRITE_TOOLS, executeTool, describeToolCall, AiToolName } from '@/lib/aiTools';
import { transcribeAudio } from '@/lib/stt';
import { synthesizeSpeech, speakableText } from '@/lib/tts';
import { useSettingsStore } from './settingsStore';
import { useTaskStore } from './taskStore';

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
  /** 流式生成中：气泡尾部渲染光标「▍」，完成即清除 */
  streaming?: boolean;
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
  '需要用户确认的写操作会先展示确认卡片，由系统处理；你只负责判断意图并调用工具。' +
  '调用工具拿到结果后，要基于结果给出自然、有信息量的总结，不要只复述原始数据。';

// 中文日期串（不依赖 Intl：Hermes 环境兼容性兜底）
function zhDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// 动态系统提示词：注入日期/倒计时/目标/今日待办，让 AI「认识」当前用户
// （否则 AI 不知道今天几号、还剩多少天，所有回答都泛泛而谈）
function buildSystemPrompt(): string {
  const now = new Date();
  const y = now.getFullYear();
  // 高考固定 6 月 7 日 9 点开考；今年已过则算次年
  const exam =
    now.getTime() >= new Date(y, 5, 7, 9, 0, 0).getTime()
      ? new Date(y + 1, 5, 7, 9, 0, 0)
      : new Date(y, 5, 7, 9, 0, 0);
  const daysLeft = Math.ceil((exam.getTime() - now.getTime()) / 86400000);
  const week = '日一二三四五六'[now.getDay()];
  const ctx: string[] = [
    `今天是${zhDate(now)}（周${week}），距 ${exam.getFullYear()} 年高考还有 ${daysLeft} 天。`,
  ];
  const { targetUniversity, targetScore } = useSettingsStore.getState();
  if (targetUniversity) ctx.push(`目标大学：${targetUniversity}。`);
  if (targetScore) ctx.push(`目标总分：${targetScore} 分。`);
  const top3 = useTaskStore.getState().top3.filter((t) => t.status !== 'done').slice(0, 3);
  if (top3.length > 0) ctx.push(`今日待办：${top3.map((t) => t.content).join('；')}。`);
  return (
    SYSTEM_PROMPT +
    '\n\n用户背景（供个性化参考，除非用户问起否则不要复述）：\n' +
    ctx.join('\n')
  );
}

interface AiState {
  visible: boolean;
  status: AiStatus;
  messages: AiMessage[];
  /** 语音对话模式：AI 回复自动播报，播完自动开始聆听，形成连续对话 */
  voiceMode: boolean;
  /** 语音管线状态：录音 → 转写 → 播报 */
  voiceState: 'idle' | 'recording' | 'transcribing' | 'speaking';
  open: () => void;
  close: () => void;
  setStatus: (s: AiStatus) => void;
  pushMessage: (m: AiMessage) => void;
  // 真实对话入口（L1-L4）：流式输出 + 工具循环（读工具结果回传模型综合，写操作挂确认卡片）
  ask: (content: string) => Promise<void>;
  // 中止当前请求：保留已生成的部分文本
  stop: () => void;
  // 视觉对话（错题图片讲解）：走独立视觉模型（GLM-4.6V-Flash 等），不传工具（视觉模型多不支持 function calling）
  askVision: (prompt: string, imageDataUrl: string) => Promise<void>;
  // 确认卡片：执行 / 取消
  confirmToolCall: (callId: string) => Promise<void>;
  cancelToolCall: (callId: string) => void;
  // 业务动作：进入“生成中”忙碌状态，完成后切回“任务完成”（供错题本 / 编译输出等入口调用）
  runAction: (label: string, durationMs?: number) => void;
  // ---------- 语音对话 ----------
  toggleVoiceMode: () => void;
  // 开始聆听（内部先打断播报：用户插话 barge-in）
  startVoiceInput: () => Promise<void>;
  // 结束聆听 → 转写 → 自动作为用户消息发送
  stopVoiceInput: () => Promise<void>;
  // 丢弃当前录音（关面板 / 关语音模式用，不触发转写发送）
  cancelVoiceInput: () => void;
  // 播报一段文本：done=播完 / interrupted=被打断或失败 / unconfigured=未配置 TTS
  speak: (text: string) => Promise<'done' | 'interrupted' | 'unconfigured'>;
  // 立即停止播报
  stopSpeaking: () => void;
}

let actionTimer: ReturnType<typeof setTimeout> | null = null;
// 当前进行中的请求控制器：用户点「停止」时 abort（仅 LLM 请求，工具内请求有自己的超时）
let abortRef: AbortController | null = null;
// ---------- 语音会话的模块级句柄（不进 state：组件不需要重渲染感知它们） ----------
let recordingRef: Audio.Recording | null = null;
let recordTimer: ReturnType<typeof setTimeout> | null = null;
let soundRef: Audio.Sound | null = null;
// speak 等待播放完成的 resolve；stopSpeaking 借它唤醒等待方
let speakResolve: (() => void) | null = null;
// 播报代数：每次 speak +1、每次 stopSpeaking 再 +1。旧代数的收尾逻辑见到代数不符即知自己已被打断
let speakGen = 0;

export const useAiStore = create<AiState>((set, get) => ({
  visible: false,
  status: 'idle',
  messages: [],
  voiceMode: false,
  voiceState: 'idle',
  open: () => {
    // 上次业务动作的收尾定时器可能还挂着，不取消会在关闭后把状态强行改成 done 并追加一条消息
    if (actionTimer) {
      clearTimeout(actionTimer);
      actionTimer = null;
    }
    set({ visible: true, status: 'listening' });
  },
  close: () => {
    if (actionTimer) {
      clearTimeout(actionTimer);
      actionTimer = null;
    }
    // 关面板顺手停掉进行中的生成：后台流式写入一个不可见的列表纯属浪费
    abortRef?.abort();
    // 语音会话同样收尾：停播报、弃录音（重新打开后不会莫名续上上一轮）
    get().stopSpeaking();
    get().cancelVoiceInput();
    set({ visible: false, status: 'idle' });
  },
  setStatus: (status) => set({ status }),
  // 保留最近 40 条，避免长对话无限堆积内存
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m].slice(-40) })),
  ask: async (content) => {
    const text = content.trim();
    if (!text || get().status === 'thinking') return;
    // 新一轮提问打断播报（用户插话 barge-in）；打断后旧语音轮次不会自动续接聆听
    get().stopSpeaking();
    get().pushMessage({ role: 'user', content: text });
    get().setStatus('thinking');
    const { llmBaseUrl, llmModel, llmApiKey } = useSettingsStore.getState();
    const controller = new AbortController();
    abortRef = controller;
    const updater = makeStreamingUpdater();
    // 收尾三件事：flush 节流缓冲 → 清 streaming 光标 → 删空气泡（模型没说话直接调工具时）
    const finishRound = () => {
      updater.end();
      markStreamDone();
      dropEmptyBubble();
    };
    try {
      // 最近 12 条纯文本历史（含刚 push 的 user 消息；toolCall 元数据不进 LLM）
      const history: ChatMessage[] = [...get().messages.slice(-12)].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const llmMessages: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt() },
        ...history,
      ];
      // 工具循环：最多 3 轮 LLM 调用 = 初始 + 2 次工具往返；最后一轮不给工具，强制文本收口
      const MAX_ROUNDS = 3;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        get().pushMessage({ role: 'assistant', content: '', streaming: true });
        const reply = await chatWithLlmStream(
          { baseUrl: llmBaseUrl, apiKey: llmApiKey, model: llmModel },
          llmMessages,
          {
            tools: round < MAX_ROUNDS - 1 ? TOOL_SCHEMAS : undefined,
            signal: controller.signal,
            onDelta: updater.push,
          }
        );
        finishRound();
        if (reply.aborted) {
          // 用户主动停止：保留已上屏的部分文本，正常收尾
          get().setStatus('done');
          return;
        }
        if (reply.toolCalls.length === 0) {
          if (!reply.content) throw new Error('模型返回为空');
          get().setStatus('done');
          // 语音对话模式：播报最终回复 → 播完自动开始下一轮聆听（连续语音对话闭环）
          if (get().voiceMode) void voiceRound(reply.content);
          return;
        }

        // 有工具调用：assistant 的 tool_calls 原样回传（OpenAI 协议要求），供下一轮综合
        llmMessages.push({
          role: 'assistant',
          content: reply.content,
          tool_calls: reply.toolCalls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        });

        let readExecuted = false;
        let writePending = false;
        for (const call of reply.toolCalls) {
          if (WRITE_TOOLS.has(call.name)) {
            writePending = true;
            get().pushMessage({
              role: 'assistant',
              content: `好的，我来${describeToolCall(call.name, call.args)}。`,
              tool: call.name as AiTool, // 工具过程消息：语音重播按钮排除
              toolCall: { id: call.id, name: call.name as AiToolName, args: call.args, state: 'pending' },
            });
            llmMessages.push({
              role: 'tool',
              content: '该操作需用户在确认卡片上确认，已生成卡片，尚未执行。',
              tool_call_id: call.id,
            });
          } else {
            // 工作状态映射：让球脸与实际动作同步（搜索→检索中，导出/读码→生成中）
            get().setStatus(
              call.name === 'searchWeb'
                ? 'searching'
                : call.name === 'exportNote' || call.name === 'correctCode'
                  ? 'generating'
                  : 'thinking'
            );
            const result = await executeTool(call.name, call.args);
            get().pushMessage({ role: 'assistant', content: result.text, tool: call.name as AiTool });
            // 工具结果截断回传：防止长输出（如整页搜索结果）撑爆上下文
            llmMessages.push({
              role: 'tool',
              content: result.text.slice(0, 2000),
              tool_call_id: call.id,
            });
            readExecuted = true;
          }
        }
        // 全是写操作：确认卡片接管对话，不再让模型多说一轮
        if (!readExecuted) {
          get().setStatus(writePending ? 'listening' : 'done');
          return;
        }
        // 下一轮：工具结果已在 llmMessages，模型综合输出最终答案（继续流式）
        get().setStatus('thinking');
      }
      get().setStatus('done');
    } catch (e) {
      finishRound();
      get().pushMessage({ role: 'assistant', content: `请求失败：${(e as Error).message}` });
      get().setStatus('error');
    } finally {
      abortRef = null;
    }
  },
  stop: () => {
    abortRef?.abort();
  },
  // 视觉对话：错题图片直接喂给视觉模型（GLM-4.6V-Flash），讲解上屏悬浮球
  askVision: async (prompt, imageDataUrl) => {
    if (get().status === 'thinking') return;
    get().pushMessage({ role: 'user', content: `${prompt}\n📷（已附错题图片）` });
    get().setStatus('thinking');
    const { visionBaseUrl, visionApiKey, visionModel } = useSettingsStore.getState();
    try {
      // 文本历史照常携带（最近 6 条），最后一条 user 为「图片+文字」视觉消息
      const history: ChatMessage[] = get()
        .messages.slice(-7, -1)
        .map((m) => ({ role: m.role, content: m.content }));
      const reply = await chatWithLlmStream(
        { baseUrl: visionBaseUrl, apiKey: visionApiKey, model: visionModel },
        [
          {
            role: 'system',
            content: `你是「高考副驾驶」。今天是${zhDate(new Date())}。用户发来一张错题图片，请：先读出题目关键条件，再给出分步解题过程，指出图中可见的作答错误（如有），最后给 1-2 个同类练习方向。回答简洁清晰，用中文。`,
          },
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
      messages: [...s.messages, { role: 'assistant' as const, content: `开始${label}…` }].slice(-40),
    }));
    actionTimer = setTimeout(() => {
      set((s) => ({
        status: 'done',
        messages: [
          ...s.messages,
          {
            role: 'assistant' as const,
            content: `${label}已完成（编译引擎上线后将产出 PDF / Anki / 大纲）。`,
          },
        ].slice(-40),
      }));
    }, durationMs);
  },
  // ---------- 语音对话实现 ----------
  toggleVoiceMode: () => {
    const next = !get().voiceMode;
    if (!next) {
      // 关闭：停播报、弃录音，中断自动续接循环
      get().stopSpeaking();
      get().cancelVoiceInput();
    } else {
      const { ttsBaseUrl, ttsApiKey } = useSettingsStore.getState();
      if (!ttsBaseUrl || !ttsApiKey) {
        get().pushMessage({
          role: 'assistant',
          content: '语音对话需要「语音合成」服务：请在「我的」页配置支持 /audio/speech 的供应商（如 OpenAI tts-1）。配置后即可开启连续语音对话。',
        });
      }
    }
    set({ voiceMode: next });
  },
  startVoiceInput: async () => {
    if (get().voiceState === 'recording' || get().status === 'thinking') return;
    // 插话打断播报（barge-in）：听和说不能同时占用音频会话
    get().stopSpeaking();
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      get().pushMessage({ role: 'assistant', content: '需要麦克风权限：请在系统设置中允许本应用录音。' });
      return;
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef = recording;
      set({ voiceState: 'recording' });
      // 60 秒兜底自动停：语音对话单轮说不了更长，防止忘记点停止一直录
      recordTimer = setTimeout(() => {
        recordTimer = null;
        void get().stopVoiceInput();
      }, 61000);
    } catch (e) {
      // 创建失败必须清干净 ref，否则下次误判为「正在录音」而无法重新开始
      recordingRef = null;
      set({ voiceState: 'idle' });
      get().pushMessage({ role: 'assistant', content: `录音失败：${(e as Error).message}` });
    }
  },
  stopVoiceInput: async () => {
    const rec = recordingRef;
    recordingRef = null;
    if (recordTimer) {
      clearTimeout(recordTimer);
      recordTimer = null;
    }
    if (!rec) return;
    set({ voiceState: 'transcribing' });
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) throw new Error('录音为空');
      // 转写配置与错题语音反思同源：stt 独立配置，留空回退 LLM 配置
      const { sttBaseUrl, sttApiKey, sttModel, llmBaseUrl, llmApiKey } = useSettingsStore.getState();
      const text = await transcribeAudio(uri, {
        baseUrl: sttBaseUrl || llmBaseUrl,
        apiKey: sttApiKey || llmApiKey,
        model: sttModel,
      });
      // 录音文件用完即删：语音对话高频产生录音，堆积会占满缓存目录
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      set({ voiceState: 'idle' });
      // 识别即发送：语音对话的连贯体验（ask 内部完成后会接播报 → 聆听）
      if (text) await get().ask(text);
    } catch (e) {
      set({ voiceState: 'idle' });
      get().pushMessage({ role: 'assistant', content: `语音识别失败：${(e as Error).message}` });
    }
  },
  cancelVoiceInput: () => {
    const rec = recordingRef;
    recordingRef = null;
    if (recordTimer) {
      clearTimeout(recordTimer);
      recordTimer = null;
    }
    if (rec) void rec.stopAndUnloadAsync().catch(() => {});
    set({ voiceState: 'idle' });
  },
  speak: async (text) => {
    const { ttsBaseUrl, ttsApiKey, ttsModel, ttsVoice } = useSettingsStore.getState();
    if (!ttsBaseUrl || !ttsApiKey) return 'unconfigured';
    const gen = ++speakGen;
    set({ voiceState: 'speaking' });
    let fileUri = '';
    try {
      fileUri = await synthesizeSpeech(speakableText(text), {
        baseUrl: ttsBaseUrl,
        apiKey: ttsApiKey,
        model: ttsModel,
        voice: ttsVoice,
      });
      if (gen !== speakGen) return 'interrupted'; // 合成期间被新播报/停止打断
      // 录音模式切播放模式：iOS 音频会话不允许边录边播
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
      if (gen !== speakGen) {
        void sound.unloadAsync().catch(() => {});
        return 'interrupted';
      }
      soundRef = sound;
      let finished = false;
      await new Promise<void>((resolve) => {
        speakResolve = resolve;
        sound.setOnPlaybackStatusUpdate((st: AVPlaybackStatus) => {
          if (st.isLoaded && (st.didJustFinish || st.error)) {
            finished = true;
            resolve();
          }
        });
        void sound.playAsync();
      });
      return finished ? 'done' : 'interrupted';
    } catch (e) {
      get().pushMessage({ role: 'assistant', content: `语音播报失败：${(e as Error).message}` });
      // 失败按中断处理：不续接自动聆听，避免配置错误导致循环刷屏
      return 'interrupted';
    } finally {
      if (soundRef) {
        void soundRef.unloadAsync().catch(() => {});
        soundRef = null;
      }
      speakResolve = null;
      if (fileUri) void FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      if (gen === speakGen) set({ voiceState: 'idle' }); // 被打断时由 stopSpeaking 负责置 idle
    }
  },
  stopSpeaking: () => {
    if (get().voiceState !== 'speaking' && !soundRef && !speakResolve) return;
    speakGen++; // 使进行中的 speak 判定为「已中断」，其 finally 不再抢状态
    if (soundRef) {
      void soundRef.stopAndUnloadAsync().catch(() => {});
      soundRef = null;
    }
    if (speakResolve) {
      const r = speakResolve;
      speakResolve = null;
      r(); // 唤醒等待中的 speak / voiceRound
    }
    set({ voiceState: 'idle' });
  },
}));

// 语音对话闭环：播报 → 自动聆听。仅自然播完才续接；打断/失败/未配置都不续
async function voiceRound(text: string) {
  const r = await useAiStore.getState().speak(text);
  if (r !== 'done') return;
  const s = useAiStore.getState();
  if (s.voiceMode && s.visible) void s.startVoiceInput();
}

// ---------- 流式上屏的三个辅助（操作 store 尾部消息，供 ask 内部使用） ----------

// 节流追加器：delta 高频到达（每秒几十次），直接 set 会拖垮渲染，80ms 批量追加到最后一条 assistant 消息
function makeStreamingUpdater() {
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const add = pending;
    pending = '';
    useAiStore.setState((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + add };
      }
      return { messages: msgs };
    });
  };
  return {
    push: (t: string) => {
      pending += t;
      if (!timer) timer = setTimeout(flush, 80);
    },
    end: () => {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

// 清掉流式标志（光标消失），消息内容保持不变
function markStreamDone() {
  useAiStore.setState((s) => {
    const msgs = [...s.messages];
    const last = msgs[msgs.length - 1];
    if (last?.streaming) {
      msgs[msgs.length - 1] = { ...last, streaming: false };
      return { messages: msgs };
    }
    return {};
  });
}

// 删除空占位气泡（模型直接调工具没说话时遗留的空气泡）
function dropEmptyBubble() {
  useAiStore.setState((s) => {
    const msgs = [...s.messages];
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant' && !last.content && !last.toolCall && !last.streaming) {
      msgs.pop();
      return { messages: msgs };
    }
    return {};
  });
}
