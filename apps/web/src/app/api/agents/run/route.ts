import { NextRequest, NextResponse } from 'next/server';
import { getAgent } from '@/lib/agents/registry';
import { runAgent } from '@/lib/agents/runAgent';
import { isAdminRequest, adminUnauthorized } from '@/lib/access';

export const dynamic = 'force-dynamic';

// 命题 Agent 统一执行入口：与 /api/tools/run 同一鉴权闸门（消耗 LLM 额度，配 ADMIN_TOKEN 后强制）。
// 返回体携带 version（prompt_version，原则 3）与 attempts，调用方落库时随产出保存。

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json(adminUnauthorized(), { status: 401 });
  }

  let body: { agentId?: unknown; input?: unknown; options?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const agent = getAgent(typeof body.agentId === 'string' ? body.agentId : '');
  if (!agent) {
    return NextResponse.json({ error: '未知 Agent ID' }, { status: 404 });
  }

  const input = typeof body.input === 'string' ? body.input : '';
  const options: Record<string, string> = {};
  if (body.options && typeof body.options === 'object' && !Array.isArray(body.options)) {
    for (const [k, v] of Object.entries(body.options as Record<string, unknown>)) {
      if (typeof v === 'string') options[k] = v;
    }
  }

  try {
    const result = await runAgent(agent, input, options);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: `${agent.name}执行失败：${(e as Error).message}` }, { status: 502 });
  }
}
