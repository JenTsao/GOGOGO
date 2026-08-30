import { NextRequest, NextResponse } from 'next/server';
import { generateDaily } from '@/lib/pipelines';

export const dynamic = 'force-dynamic';

// 凌晨备课流水线（Vercel Cron 04:00 北京时间，见 vercel.json）
// 鉴权后调用共享管道（lib/pipelines），管理台手动触发走同一实现
export async function GET(req: NextRequest) {
  // fail-closed：CRON_SECRET 未配置时拒绝执行，防止公网裸奔触发 LLM 消耗
  //（Vercel Cron 在设置了 CRON_SECRET 后会自动附带 Authorization 头）
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: '未配置 CRON_SECRET，已拒绝执行（防公网滥用）' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const result = await generateDaily();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
