// 提示词 Token 预算与上下文注入（算法参照 OpenAI Codex 的提示词构建与上下文注入模型）
// 五段式结构中与本应用相关的三段按预算装配：不可截断的说明文字 + 核心输入 → 材料/锚点等可截断块按优先级填充
// 优先级约定：priority 越大越重要，预算不足时先截断 priority 小的块；历史滚动窗口由调用方自行处理（各流水线历史极短）

/** token 近似计数：中英混合 ≈ 2 字符/token（中文 1 token≈1.5-2 字符、英文≈4 字符的折中，误差 <15%） */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

export interface ClipResult {
  text: string;
  truncated: boolean;
}

/** 截断到 token 预算，保留头部 + 显式标记（调用方需要知道截断发生，便于回传给用户/日志） */
export function clipToBudget(text: string, maxTokens: number): ClipResult {
  const maxChars = maxTokens * 2;
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n…[内容已截断，仅保留前 ${maxTokens} tokens]`,
    truncated: true,
  };
}

export interface PromptSection {
  key: string; // 标识块用途（材料 / 知识库锚点 / 工具描述…）
  content: string;
  priority: number; // 越大越优先注入；同优先级按数组顺序
}

export interface BuildPromptOptions {
  /** 不可截断的说明文字（题型规格 / JSON 契约等） */
  prefix?: string;
  /** 不可截断的核心输入（用户材料 / 命题原文），放最后且保证完整 */
  input: string;
  /** 可截断的上下文块，按 priority 降序填充剩余预算 */
  sections?: PromptSection[];
  /** 整个 user prompt 的 token 预算（不含 system prompt —— 那是注册表的静态资产，天然受控） */
  maxTokens: number;
}

export interface BuiltPrompt {
  text: string;
  truncatedKeys: string[]; // 发生截断的块（供日志/响应标记）
  totalTokens: number;
}

/**
 * 装配 user prompt：
 * 1. 固定开销 = prefix + input（不可截断；input 自身超预算时才做最后兜底截断）
 * 2. 剩余预算 = maxTokens - 固定开销，按 priority 降序填充 sections（每块独立截断 + 标记）
 * 复杂度 O(N)，N 为 sections 数
 */
export function buildUserPrompt(opts: BuildPromptOptions): BuiltPrompt {
  const { prefix = '', input, sections = [], maxTokens } = opts;
  const truncatedKeys: string[] = [];

  const fixed = `${prefix}${prefix ? '\n\n' : ''}${input}`;
  let used = countTokens(fixed);

  // 固定部分本身超预算：对 input 兜底截断（prefix 优先保全，它是行为指令）
  if (used > maxTokens) {
    const inputBudget = Math.max(500, maxTokens - countTokens(prefix));
    const clipped = clipToBudget(input, inputBudget);
    if (clipped.truncated) truncatedKeys.push('__input__');
    const text = `${prefix}${prefix ? '\n\n' : ''}${clipped.text}`;
    return { text, truncatedKeys, totalTokens: countTokens(text) };
  }

  // 按优先级降序填充（稳定排序：同优先级保持传入顺序）
  const ordered = [...sections]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.priority - a.s.priority || a.i - b.i)
    .map(({ s }) => s);

  const rendered = new Map<string, string>();
  for (const section of ordered) {
    const remain = maxTokens - used;
    if (remain <= 100) {
      // 剩余预算不足以注入任何有意义的块：整块丢弃（比截到 50 token 的碎片更有用）
      truncatedKeys.push(section.key);
      rendered.set(section.key, '');
      continue;
    }
    const clipped = clipToBudget(section.content, remain);
    if (clipped.truncated) truncatedKeys.push(section.key);
    rendered.set(section.key, clipped.text);
    used += countTokens(clipped.text);
  }

  // 按原始顺序拼回（材料在前、锚点在后的阅读顺序不受预算排序影响）
  const body = sections
    .map((s) => rendered.get(s.key) ?? '')
    .filter(Boolean)
    .join('\n\n');

  const text = `${fixed}${body ? `\n\n${body}` : ''}`;
  return { text, truncatedKeys, totalTokens: countTokens(text) };
}
