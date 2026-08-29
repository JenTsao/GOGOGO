import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion, parseJsonLoose } from '@/lib/llm';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// 凌晨备课流水线（Vercel Cron 04:00 北京时间，见 vercel.json）
// 采集素材 → LLM 生成「每日知识点 + 每日一题」→ 写入 daily_learning
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
    const owner = requireAdminEnv();

    // 北京时间当天（UTC+8 偏移后取日期段）
    const sh = new Date(Date.now() + 8 * 3600 * 1000);
    const today = sh.toISOString().slice(0, 10);

    // 幂等：当天已生成则跳过
    const { data: exist } = await supabaseAdmin()
      .from('daily_learning')
      .select('id')
      .eq('user_id', owner)
      .eq('date', today)
      .maybeSingle();
    if (exist) return NextResponse.json({ ok: true, skipped: '今日内容已存在', date: today });

    // 采集：昨日完成任务 + 近 7 天错题科目/标签 + 未来 3 天提醒
    const yesterday = new Date(sh.getTime() - 86400000).toISOString().slice(0, 10);
    const in3days = new Date(sh.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    const weekAgo = new Date(sh.getTime() - 7 * 86400000).toISOString();
    const [tasks, mistakes, reminders] = await Promise.all([
      supabaseAdmin()
        .from('tasks')
        .select('content, subject, date')
        .eq('user_id', owner)
        .eq('status', 'done')
        .gte('date', yesterday)
        .lte('date', today)
        .limit(20),
      supabaseAdmin()
        .from('mistakes')
        .select('subject, tags')
        .eq('user_id', owner)
        .gte('created_at', weekAgo)
        .limit(20),
      supabaseAdmin()
        .from('reminders')
        .select('content, date')
        .eq('user_id', owner)
        .gte('date', today)
        .lte('date', in3days)
        .limit(10),
    ]);

    const material = JSON.stringify({
      doneTasks: tasks.data ?? [],
      recentMistakes: mistakes.data ?? [],
      upcomingReminders: reminders.data ?? [],
    });

    const raw = await chatCompletion(
      [
        { role: 'system', content: '你是严谨的高考备课引擎，只输出 JSON，不输出任何其他文字。' },
        {
          role: 'user',
          content:
            '基于学习素材生成今日备课。要求：' +
            '1) knowledge_body：一个今日知识点讲解，100 字以内，末尾附一句记忆口诀；' +
            '2) question_text：一道与知识点相关的中高难度题目（含题干，不含答案）；' +
            '3) answer：该题的分步解析。' +
            '若素材为空，则选取高考高频考点生成。' +
            `严格输出 JSON：{"knowledge_body":"...","question_text":"...","answer":"..."}。素材：${material}`,
        },
      ],
      { temperature: 0.6 }
    );

    const json = parseJsonLoose(raw);
    if (!json || !json.knowledge_body || !json.question_text) {
      throw new Error(`生成结果无法解析：${raw.slice(0, 200)}`);
    }

    // upsert 而非 insert：唯一约束 (user_id, date) 已在 schema 中建立，
    // 「先查后插」在 Cron 重投/并发重试下仍会撞车，交给 DB 冲突解决才是幂等的
    const { error: insertErr } = await supabaseAdmin()
      .from('daily_learning')
      .upsert(
        {
          user_id: owner,
          date: today,
          knowledge_body: String(json.knowledge_body),
          question_text: String(json.question_text),
          answer: String(json.answer ?? ''),
        },
        { onConflict: 'user_id,date' }
      );
    if (insertErr) throw new Error(`写入 daily_learning 失败：${insertErr.message}`);

    return NextResponse.json({ ok: true, date: today, knowledge: json.knowledge_body });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
