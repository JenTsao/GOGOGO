// 命题 Agent 统一调用封装：所有 agent 共用一条执行路径。
// 职责：S0 拼接 → 输入预算截断 → LLM 调用（逐调用 temperature / maxTokens）→
// JSON 解析（失败带原始输出重试一次再降级）→ 版本化返回。
import { S0_PROMPT } from './s0';
import { buildUserPrompt, countTokens } from '@/lib/promptBudget';
import { chatCompletion, parseJsonLoose, type ChatMessage } from '@/lib/llm';
import type { AgentDef } from './registry';

export interface AgentRunResult {
  agentId: string;
  /** prompt 版本（原则 3：调用方落库时随产出写入 prompt_version） */
  version: string;
  /** 解析后的 JSON 数据 */
  data: Record<string, unknown>;
  attempts: 1 | 2;
  /** 输入是否被预算截断 */
  inputTruncated: boolean;
  totalInputTokens: number;
}

/** 用户选项 → 指令行（choices.promptSuffix 依序追加），空返回空串 */
function optionSuffix(def: AgentDef, options?: Record<string, string>): string {
  if (!def.options?.length) return '';
  const lines: string[] = [];
  for (const opt of def.options) {
    const chosen = options?.[opt.key] ?? opt.choices[0]?.value;
    const choice = opt.choices.find((c) => c.value === chosen) ?? opt.choices[0];
    if (choice?.promptSuffix) lines.push(choice.promptSuffix);
  }
  return lines.length ? `${lines.join('\n')}\n\n` : '';
}

/**
 * 运行一个命题 Agent。
 * 失败语义：两次输出均无法解析为 JSON 时 throw（调用方决定降级策略）；
 * 重试时把原始输出回喂给模型并降温，给一次自我修复的机会（原则 2）。
 */
export async function runAgent(
  def: AgentDef,
  input: string,
  options?: Record<string, string>
): Promise<AgentRunResult> {
  const clean = input.trim();
  if (!clean) throw new Error(`${def.name}：输入为空（${def.inputHint}）`);

  // S0 共享前缀 + options 指令行 + 专属主体（原则 1）
  const system = `${S0_PROMPT}\n\n${optionSuffix(def, options)}${def.systemPrompt}`.trim();

  // 输入预算：≈2 字符/token，超限保头部 + 截断标记（长文输入是常态，提示词预算模型兜底）
  const maxInputTokens = Math.ceil(def.maxInputChars / 2);
  const prompt = buildUserPrompt({ input: clean, maxTokens: maxInputTokens });

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompt.text },
  ];

  let raw = await chatCompletion(messages, {
    temperature: def.temperature,
    maxTokens: def.maxOutputTokens,
  });
  let data = parseJsonLoose(raw);
  let attempts: 1 | 2 = 1;

  if (!data) {
    // 重试一次：回喂原始输出 + 明确纠偏指令 + 降温（0.75 → 0.45 级别），提升 JSON 合规率
    messages.push({ role: 'assistant', content: raw.slice(0, 2000) });
    messages.push({
      role: 'user',
      content: '上面的输出无法解析为合法 JSON。请重新输出：只输出一个 ```json 代码块，内部是完整合法的 JSON 对象，不要任何解释文字、不要输出不完整的 JSON（输出被截断时请压缩非关键字段长度）。',
    });
    raw = await chatCompletion(messages, {
      temperature: Math.max(0.2, def.temperature - 0.3),
      maxTokens: def.maxOutputTokens,
    });
    data = parseJsonLoose(raw);
    attempts = 2;
  }

  if (!data) {
    throw new Error(`${def.name} 输出两次均无法解析为 JSON（最后一次：${raw.slice(0, 150)}…）`);
  }

  return {
    agentId: def.id,
    version: def.version,
    data,
    attempts,
    inputTruncated: prompt.truncatedKeys.includes('__input__'),
    totalInputTokens: countTokens(prompt.text),
  };
}
