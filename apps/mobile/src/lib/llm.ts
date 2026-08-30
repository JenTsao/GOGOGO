// 移动端多供应商 LLM 客户端：OpenAI 兼容协议（BYOK，Key 存 MMKV 由用户自配）
// 流式走 expo/fetch（原生实现）：RN 全局 fetch 的 polyfill 不暴露 res.body，读不了 SSE
import { fetch as expoFetch } from 'expo/fetch';

export interface LlmPreset {
  label: string;
  baseUrl: string;
  model: string;
}

export const LLM_PRESETS: Record<string, LlmPreset> = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  moonshot: { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  glm: { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  custom: { label: '自定义', baseUrl: '', model: '' },
};

// OpenAI 兼容视觉消息片段（GLM-4.6V-Flash / gpt-4o 系列均支持该格式）
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[];
  /** assistant 消息携带的工具调用（OpenAI 协议：工具结果回传时必须原样带上） */
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  /** role=tool 时对应的调用 ID */
  tool_call_id?: string;
}

// 组装「图片 + 文字」视觉消息（dataUrl = data:image/jpeg;base64,... 或公网图片 URL）
export function imageTextContent(text: string, imageUrl: string): ChatContentPart[] {
  return [
    { type: 'image_url', image_url: { url: imageUrl } },
    { type: 'text', text },
  ];
}

export interface MistakeRecognition {
  subject: string;
  tags: string[];
  summary: string;
}

// 错题图片多模态识别：视觉模型读照片 → 学科判定 + 卡壳标签 + 题面摘要（JSON 容错解析）
export async function recognizeMistake(
  cfg: { baseUrl: string; apiKey: string; model: string },
  imageDataUrl: string
): Promise<MistakeRecognition> {
  const res = await chatWithLlm(cfg, [
    {
      role: 'system',
      content:
        '你是错题整理助手。识别用户发来的错题照片，只输出一个 JSON 对象（不要 markdown 代码块、不要多余文字）：' +
        '{"subject":"学科","tags":["卡壳点"],"summary":"题面与作答情况摘要，80字内"}。' +
        'subject 必须从：数学/语文/英语/物理/化学/生物/历史/地理/政治 中选一个；' +
        'tags 提取 2-4 个卡壳术语（如：导数、设辅助函数、计算失误、单位换算）；' +
        'summary 简述题目考的知识点和学生作答/错误情况（照片可见时）。照片模糊或不是题目时，subject 给"数学"，tags 为空，summary 说明情况。',
    },
    { role: 'user', content: imageTextContent('识别这张错题照片并输出 JSON。', imageDataUrl) },
  ]);
  // 容错解析：剥掉可能的 ```json 围栏，截取第一个 {...}
  const raw = res.content.replace(/```(?:json)?/g, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  // end 必须严格大于 start：模型只回半个 JSON 时 slice 会得到空串，JSON.parse('') 抛 SyntaxError
  if (start === -1 || end <= start) throw new Error('识别结果无法解析');
  let parsed: Partial<MistakeRecognition> = {};
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<MistakeRecognition>;
  } catch {
    throw new Error('识别结果不是合法 JSON');
  }
  return {
    subject: typeof parsed.subject === 'string' ? parsed.subject : '数学',
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === 'string').slice(0, 4) : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  };
}

// OpenAI 兼容工具定义（L4 调度用；主流供应商均支持）
export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
}

export async function chatWithLlm(
  cfg: { baseUrl: string; apiKey: string; model: string },
  messages: ChatMessage[],
  opts?: { tools?: ToolDef[]; signal?: AbortSignal }
): Promise<LlmResponse> {
  // model 必填：OpenAI 兼容协议严格要求 model 字段，留空会被 OpenAI/DeepSeek 直连等严格供应商 400 拒绝
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new Error('请先在「我的」Tab 配置 AI 供应商、模型名与 API Key');
  }
  // 超时必须可中止：供应商挂起会让悬浮球永远停在「思考中」，用户只能杀 App
  // 外部 signal（用户点停止）与超时 signal 任一触发即中止
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  opts?.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.7,
        ...(opts?.tools ? { tools: opts.tools } : {}),
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
    // 用户主动停止 vs 超时：文案必须区分，否则停止被误报为网络问题
    throw opts?.signal?.aborted
      ? new Error('已停止')
      : new Error('请求超时（60 秒），请检查网络或供应商地址');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      };
    }[];
  };
  const msg = data.choices?.[0]?.message;
  const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}');
    } catch {
      // 参数解析失败按空参处理，由工具执行侧兜底
    }
    return { id: tc.id, name: tc.function.name, args };
  });
  if (!msg?.content && toolCalls.length === 0) throw new Error('模型返回为空');
  return { content: msg?.content ?? '', toolCalls };
}

// ============================================================
// 流式客户端：SSE 增量解析 + 工具调用增量累积 + 可中断
// ============================================================

export interface StreamOpts {
  tools?: ToolDef[];
  /** 外部中止信号（用户点「停止」） */
  signal?: AbortSignal;
  /** 每收到一段文本增量回调（用于逐字上屏） */
  onDelta?: (text: string) => void;
}

export interface StreamResult extends LlmResponse {
  /** 用户主动中止时为 true：返回已累积的部分内容而非抛错 */
  aborted?: boolean;
}

// SSE 单帧结构（OpenAI 兼容）：data: {"choices":[{"delta":{...}}]}
interface StreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
}

class HttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

async function streamOnce(
  cfg: { baseUrl: string; apiKey: string; model: string },
  messages: ChatMessage[],
  opts?: StreamOpts
): Promise<StreamResult> {
  let res: Response;
  try {
    res = await expoFetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.7,
        stream: true,
        ...(opts?.tools ? { tools: opts.tools } : {}),
      }),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { content: '', toolCalls: [], aborted: true };
    throw e;
  }
  if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ''));

  let content = '';
  let aborted = false;
  // 工具调用按 index 累积：id/name 只在首帧出现，arguments 逐帧拼接
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  const emit = (chunk: StreamChunk) => {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      content += delta.content;
      opts?.onDelta?.(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const cur = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      toolAcc.set(tc.index, cur);
    }
  };

  const reader = res.body?.getReader();
  if (!reader) throw new Error('供应商未返回流式响应体');
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 按行切分，最后一段可能是不完整帧，留在 buffer 等下一批字节
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          emit(JSON.parse(payload) as StreamChunk);
        } catch {
          // 单帧损坏跳过，不影响后续帧
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') aborted = true;
    else throw e;
  }

  const toolCalls: ToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(t.args || '{}');
      } catch {
        // 参数解析失败按空参处理，由工具执行侧兜底
      }
      return {
        // 个别供应商流式不带 id：生成兜底 id，保证 tool_call_id 能对上
        id: t.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: t.name,
        args,
      };
    })
    .filter((t) => t.name);
  if (!content && toolCalls.length === 0 && !aborted) throw new Error('模型返回为空');
  return aborted ? { content, toolCalls, aborted: true } : { content, toolCalls };
}

// 流式对话入口：优先 SSE 流式（逐字上屏），供应商不支持 stream 参数时自动降级非流式
export async function chatWithLlmStream(
  cfg: { baseUrl: string; apiKey: string; model: string },
  messages: ChatMessage[],
  opts?: StreamOpts
): Promise<StreamResult> {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new Error('请先在「我的」Tab 配置 AI 供应商、模型名与 API Key');
  }
  try {
    return await streamOnce(cfg, messages, opts);
  } catch (e) {
    // 自定义中转站常对 stream 参数直接 400/404：降级非流式重试一次
    // 401/403（Key 错误）/429（限流）降级无意义，原样抛出
    if (e instanceof HttpError && [400, 404, 422].includes(e.status)) {
      try {
        return await chatWithLlm(cfg, messages, { tools: opts?.tools, signal: opts?.signal });
      } catch (e2) {
        if (opts?.signal?.aborted) return { content: '', toolCalls: [], aborted: true };
        throw e2;
      }
    }
    throw e;
  }
}
