'use server';

import { revalidatePath } from 'next/cache';
import { generateDailyQuestions } from '@/lib/pipelines';

// 猜题页手动触发：与 Vercel Cron 共用同一管道实现；force=true 覆盖重生成
export async function regenQuestions(force: boolean): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await generateDailyQuestions({ force });
    revalidatePath('/questions');
    const done = r.results.filter((x) => x.status === 'done').length;
    const skipped = r.results.filter((x) => x.status === 'skipped').length;
    const failed = r.results.filter((x) => x.status === 'failed');
    const parts = [
      done ? `已生成 ${done} 科` : '',
      skipped ? `${skipped} 科已存在` : '',
      ...failed.map((f) => `${f.subject}失败：${f.detail ?? ''}`),
    ].filter(Boolean);
    return { ok: failed.length === 0, message: parts.join('；') || '无变化' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
