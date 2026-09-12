import { NextRequest, NextResponse } from 'next/server';
import { collectMaterials } from '@/lib/collector/pool';

export const dynamic = 'force-dynamic';
// 采集要并发拉 15 个外源 + 逐篇 LLM 打分，是本项目最重的定时任务。
// Vercel Hobby 的函数时长上限较低，若日志出现超时把 COLLECT_MAX_PER_RUN 调小（默认 24）。
export const maxDuration = 300;

// 每日素材采集（建议 Vercel Cron 北京时间 03:00，早于 04:20 的猜题流水线）
// 鉴权与 /api/cron/daily 同模式：fail-closed，CRON_SECRET 未配置时拒绝执行
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: '未配置 CRON_SECRET，已拒绝执行（防公网滥用）' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const maxPerRun = Math.min(Number(process.env.COLLECT_MAX_PER_RUN) || 24, 60);
    const report = await collectMaterials({ maxPerRun });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
