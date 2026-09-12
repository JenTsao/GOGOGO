import { NextRequest, NextResponse } from 'next/server';
import { getTool, buildSystemPrompt, DEFAULT_MAX_INPUT_CHARS } from '@/lib/aiTools/registry';
import { clipToBudget } from '@/lib/promptBudget';
import { chatCompletion } from '@/lib/llm';
import { isAdminRequest, adminUnauthorized } from '@/lib/access';

export const dynamic = 'force-dynamic';

// AI 工具区统一执行入口：所有工具共用这一个 Route Handler，
// 工具差异全部收敛在 registry（systemPrompt / temperature / options）里。
// 新增工具无需动此文件。

export async function POST(req: NextRequest) {
  // 工具运行会消耗 LLM 额度，公开部署时必须鉴权（配置 ADMIN_TOKEN 后强制，与工坊精炼同一闸门）
  if (!isAdminRequest(req)) {
    return NextResponse.json(adminUnauthorized(), { status: 401 });
  }

  let body: { toolId?: unknown; input?: unknown; options?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const tool = getTool(typeof body.toolId === 'string' ? body.toolId : '');
  if (!tool) {
    return NextResponse.json({ error: '未知工具 ID' }, { status: 404 });
  }

  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (!input) {
    return NextResponse.json({ error: `请输入${tool.inputLabel}` }, { status: 400 });
  }

  const maxChars = tool.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  // 字符上限 → token 预算（≈2 字符/token，口径同 promptBudget.countTokens）：
  // 超限保留头部 + 显式截断标记，truncated 由前端提示（知识密度通常前高后低，与工坊精炼同策略）
  const clipped = clipToBudget(input, Math.ceil(maxChars / 2)).text;
  const truncated = input.length > maxChars;

  const options =
    body.options && typeof body.options === 'object' && !Array.isArray(body.options)
      ? (body.options as Record<string, unknown>)
      : {};
  // 只取字符串值，其余类型丢弃（防注入非预期结构）
  const safeOptions: Record<string, string> = {};
  for (const [k, v] of Object.entries(options)) {
    if (typeof v === 'string') safeOptions[k] = v;
  }

  try {
    const text = await chatCompletion(
      [
        { role: 'system', content: buildSystemPrompt(tool, safeOptions) },
        { role: 'user', content: clipped },
      ],
      { temperature: tool.temperature ?? 0.5 }
    );
    return NextResponse.json({ toolId: tool.id, text, truncated });
  } catch (e) {
    return NextResponse.json({ error: `${tool.name}失败：${(e as Error).message}` }, { status: 502 });
  }
}
