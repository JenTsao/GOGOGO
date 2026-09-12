// 工具审批工作流内核（算法参照 OpenAI Codex 的 MCP 工具调用与审批模型）
// 状态机：决策（needsApproval）→ 执行 / 走确认卡片（aiStore.confirmToolCall）→ 完成/拒绝，全程审计留痕
// 本模块不 import 任何工具实现 —— 工具清单与风险标注在 lib/aiTools.ts（单向依赖，避免循环）
import { storage } from '../store/storage';

/** 工具风险分级（对应 Codex 的 Low/Medium/High） */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * 审批策略（用户可在「我的」配置，settingsStore.approvalPolicy，默认 suggest）：
 * - auto：全部自动执行（信任度最高，写操作也不打断）
 * - suggest：低风险直读直返，中风险以上需确认卡片（默认，平衡效率与安全）
 * - ask：一律确认（最严格）
 */
export type ApprovalPolicy = 'auto' | 'suggest' | 'ask';

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

/**
 * 审批决策函数（对应 Codex 的 approve(T, policy)）：
 * returns true = 需要用户确认（Approving 态，走确认卡片）；false = 自动执行
 */
export function needsApproval(policy: ApprovalPolicy, risk: RiskLevel): boolean {
  switch (policy) {
    case 'auto':
      return false;
    case 'suggest':
      return RISK_RANK[risk] >= RISK_RANK.medium;
    case 'ask':
      return true;
  }
}

/**
 * 工具结果截断（对应 Codex 的 truncate(result, max_tokens)）：
 * 超预算保留头部 + 显式截断标记，防止长输出撑爆下一轮上下文。
 * token 近似口径：中英混合 ≈ 2 字符/token（中文 1 token≈1.5-2 字符、英文≈4 字符的折中，误差 <15%）
 */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

export function truncateToolOutput(text: string, maxTokens = 800): { text: string; truncated: boolean } {
  const maxChars = maxTokens * 2;
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n…[输出已截断，仅保留前 ${maxTokens} tokens]`, truncated: true };
}

// ---------- 审计日志：决策与执行结果落 MMKV，环形 50 条，供排查「AI 到底动了我什么」 ----------

export interface ToolAuditEntry {
  at: number; // 时间戳 ms
  tool: string; // 工具名
  decision: 'auto' | 'confirmed' | 'rejected'; // 自动执行 / 用户确认 / 用户取消
  argsHint: string; // 参数摘要（≤60 字符，避免记录敏感全文）
  ok?: boolean; // 执行结果（确认/自动执行时记录）
}

const AUDIT_KEY = 'ai_tool_audit';
const AUDIT_LIMIT = 50;
const ARGS_HINT_CHARS = 60;

export function getToolAuditLog(): ToolAuditEntry[] {
  try {
    return parseAudit(storage.getString(AUDIT_KEY));
  } catch {
    return [];
  }
}

export function pushToolAudit(entry: Omit<ToolAuditEntry, 'at'>): void {
  try {
    const log = [{ ...entry, at: Date.now() }, ...getToolAuditLog()].slice(0, AUDIT_LIMIT);
    storage.set(AUDIT_KEY, JSON.stringify(log));
  } catch {
    // 审计是增值能力，存储失败不影响工具主流程
  }
}

function parseAudit(raw: string | null | undefined): ToolAuditEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ToolAuditEntry[]) : [];
  } catch {
    return [];
  }
}

/** 参数摘要：把 args 压成一行短文本用于审计，不记录完整内容 */
export function argsHint(args: Record<string, unknown>): string {
  const s = JSON.stringify(args);
  return s.length > ARGS_HINT_CHARS ? `${s.slice(0, ARGS_HINT_CHARS)}…` : s;
}
