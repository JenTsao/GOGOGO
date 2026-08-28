import { NextRequest, NextResponse } from 'next/server';
import { syncKnowledge } from '@/lib/knowledgeSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 手动向量化（语义检索中心按钮）：与定时任务共用 syncKnowledge 核心
export async function POST(req: NextRequest) {
  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 10, 30);
    const result = await syncKnowledge(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
