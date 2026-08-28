// 移动端多供应商 LLM 客户端：OpenAI 兼容协议（BYOK，Key 存 MMKV 由用户自配）
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
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
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
  if (start === -1 || end === -1) throw new Error('识别结果无法解析');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<MistakeRecognition>;
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
  opts?: { tools?: ToolDef[] }
): Promise<LlmResponse> {
  // model 必填：OpenAI 兼容协议严格要求 model 字段，留空会被 OpenAI/DeepSeek 直连等严格供应商 400 拒绝
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new Error('请先在「我的」Tab 配置 AI 供应商、模型名与 API Key');
  }
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.7,
      ...(opts?.tools ? { tools: opts.tools } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
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
