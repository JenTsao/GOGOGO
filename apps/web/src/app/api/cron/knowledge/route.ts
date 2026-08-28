import { NextRequest, NextResponse } from 'next/server';
import { syncKnowledge } from '@/lib/knowledgeSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Obsidian 向量化定时任务（vercel.json：每日 04:10 北京时间，备课 04:00 之后、周复盘 04:30 之前）
// CRON_SECRET Bearer 鉴权（与 /api/cron/daily、/api/cron/weekly 同一模型）
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  try {
    // 每轮 30 篇：哈希未变的自动跳过，笔记多时数天收敛全量，日常增量当日完成
    const result = await syncKnowledge(30);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
