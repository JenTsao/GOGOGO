import { NextRequest, NextResponse } from 'next/server';
import { generateDailyQuestions } from '@/lib/pipelines';

export const dynamic = 'force-dynamic';

// 每日猜题流水线（Vercel Cron 北京时间 04:20，见 vercel.json）
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
    const result = await generateDailyQuestions();
    const failed = result.results.filter((r) => r.status === 'failed');
    // 部分科目失败不算整体失败（cron 重试只重跑失败科目——已成功科目幂等跳过）
    return NextResponse.json({ ok: failed.length === 0, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
