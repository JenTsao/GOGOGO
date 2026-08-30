import { NextRequest, NextResponse } from 'next/server';
import { generateWeekly } from '@/lib/pipelines';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 每周画像复盘 + 资讯自动检索（Vercel Cron 每周一 04:30 北京时间，见 vercel.json）
// 鉴权后调用共享管道（lib/pipelines），管理台手动触发走同一实现
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: '未配置 CRON_SECRET，已拒绝执行' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const result = await generateWeekly();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
