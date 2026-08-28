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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatWithLlm(
  cfg: { baseUrl: string; apiKey: string; model: string },
  messages: ChatMessage[]
): Promise<string> {
  // model 允许为空：自定义供应商留空时由后端按默认模型处理，只校验必填的 baseUrl 与 apiKey
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new Error('请先在「我的」Tab 配置 AI 供应商与 API Key');
  }
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    // model 为空时整个字段省略而非传空串，避免后端收到无效模型名报错
    body: JSON.stringify({ ...(cfg.model ? { model: cfg.model } : {}), messages, temperature: 0.7 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型返回为空');
  return content;
}
