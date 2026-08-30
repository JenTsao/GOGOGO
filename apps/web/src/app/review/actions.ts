'use server';

import { revalidatePath } from 'next/cache';
import { generateDaily, generateWeekly } from '@/lib/pipelines';

// 复盘页手动触发：与 Vercel Cron 共用同一管道实现；force=true 覆盖重生成

export async function regenDaily(force: boolean): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await generateDaily({ force });
    revalidatePath('/review');
    revalidatePath('/');
    return { ok: true, message: r.skipped ?? `已生成 ${r.date} 的备课内容` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function regenWeekly(force: boolean): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await generateWeekly({ force });
    revalidatePath('/review');
    revalidatePath('/');
    return { ok: true, message: r.skipped ?? `已生成 ${r.weekStart} 那一周的复盘` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
