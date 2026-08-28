// 多供应商 LLM 适配层：统一走 OpenAI 兼容协议（/chat/completions、/embeddings）
// 供应商仅是「baseURL + 模型名 + Key」的组合，新增供应商只需加一行注册项
export interface ProviderInfo {
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
}

export const LLM_PROVIDERS: Record<string, ProviderInfo> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini' },
  moonshot: { baseUrl: 'https://api.moonshot.cn/v1', apiKeyEnv: 'MOONSHOT_API_KEY', defaultModel: 'moonshot-v1-8k' },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'GLM_API_KEY', defaultModel: 'glm-4-flash' },
};

// 向量维度必须与 schema.sql 的 vector(1536) 一致：两家均支持 dimensions=1536
export const EMBEDDING_PROVIDERS: Record<string, ProviderInfo> = {
  openai: { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'text-embedding-3-small' },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'GLM_API_KEY', defaultModel: 'embedding-3' },
};

interface Resolved {
  info: ProviderInfo;
  apiKey: string;
  model: string;
}

function pick(
  registry: Record<string, ProviderInfo>,
  providerName: string | undefined,
  modelOverride: string | undefined,
  fallbackProvider: string
): Resolved {
  const key = providerName && registry[providerName] ? providerName : fallbackProvider;
  const info = registry[key];
  return {
    info,
    apiKey: process.env[info.apiKeyEnv] ?? '',
    model: modelOverride || info.defaultModel,
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { provider?: string; model?: string; temperature?: number }
): Promise<string> {
  const p = pick(LLM_PROVIDERS, opts?.provider ?? process.env.LLM_PROVIDER, opts?.model ?? process.env.LLM_MODEL, 'deepseek');
  if (!p.apiKey) throw new Error(`未配置 ${p.info.apiKeyEnv}（.env.local）`);
  const res = await fetch(`${p.info.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({ model: p.model, messages, temperature: opts?.temperature ?? 0.7 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回为空');
  return content;
}

export async function embedTexts(
  texts: string[],
  opts?: { provider?: string; model?: string }
): Promise<number[][]> {
  const p = pick(EMBEDDING_PROVIDERS, opts?.provider ?? process.env.EMBEDDING_PROVIDER, opts?.model ?? process.env.EMBEDDING_MODEL, 'openai');
  if (!p.apiKey) throw new Error(`未配置 ${p.info.apiKeyEnv}（.env.local）`);
  const res = await fetch(`${p.info.baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({ model: p.model, input: texts, dimensions: 1536 }),
  });
  if (!res.ok) throw new Error(`Embedding ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
  const rows = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
  return rows.map((r) => r.embedding);
}

// 容忍模型输出代码围栏：提取首个 { 到最后一个 } 的 JSON
export function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
