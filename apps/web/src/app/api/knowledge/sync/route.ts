import { NextRequest, NextResponse } from 'next/server';
import { syncKnowledge } from '@/lib/knowledgeSync';
import { isAdminRequest, adminUnauthorized } from '@/lib/access';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 手动向量化（语义检索中心按钮）：与定时任务共用 syncKnowledge 核心
export async function POST(req: NextRequest) {
  // 每次调用都会产生 embedding 费用，公开部署时必须鉴权（定时任务走 /api/cron/knowledge 的 CRON_SECRET）
  if (!isAdminRequest(req)) {
    return NextResponse.json(adminUnauthorized(), { status: 401 });
  }
  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 10, 30);
    const result = await syncKnowledge(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
