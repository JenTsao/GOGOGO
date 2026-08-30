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
  // 配置了不存在的供应商名时必须告警：静默回退会误导排查（报错指向 fallback 的 Key）甚至把请求发给非预期供应商
  if (providerName && !registry[providerName]) {
    console.warn(`[llm] 供应商 "${providerName}" 不在注册表中，已回退到 "${fallbackProvider}"`);
  }
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// LLM 请求统一超时 + 重试：供应商 429/5xx 与网络抖动是 cron 流水线的主要失败源
// （凌晨批跑无人值守，一次限流就丢一整天的备课内容）。仅重试可恢复错误；
// 4xx（参数/Key 错误）重试无意义，原样抛出。最后一次尝试的错误响应保持原报错格式交回调用方。
async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number, retries = 2): Promise<Response> {
  let lastErr: Error = new Error('请求失败');
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await res.text().catch(() => ''); // 读完 body 释放连接再退避
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastErr =
        (e as Error).name === 'AbortError'
          ? new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`)
          : (e as Error);
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { provider?: string; model?: string; temperature?: number }
): Promise<string> {
  const p = pick(LLM_PROVIDERS, opts?.provider ?? process.env.LLM_PROVIDER, opts?.model ?? process.env.LLM_MODEL, 'deepseek');
  if (!p.apiKey) throw new Error(`未配置 ${p.info.apiKeyEnv}（.env.local）`);
  const res = await fetchWithRetry(`${p.info.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({ model: p.model, messages, temperature: opts?.temperature ?? 0.7 }),
  }, 120000);
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
  const res = await fetchWithRetry(`${p.info.baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({ model: p.model, input: texts, dimensions: 1536 }),
  }, 30000);
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
