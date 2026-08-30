import { chatCompletion, parseJsonLoose } from '@/lib/llm';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * 备课流水线核心：从 cron route 抽出，供 Vercel Cron 与管理台「手动触发」共用。
 * 幂等：默认当天/本周已存在则跳过；force=true 时强制重生成（upsert 覆盖）。
 */

interface NewsItem {
  title: string;
  url: string;
  snippet: string;
}

// Tavily 资讯检索。Key 未配置时返回空（降级为纯本地复盘）
async function tavilySearch(query: string): Promise<NewsItem[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: 5, search_depth: 'basic' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: (r.content ?? '').slice(0, 150) }));
  } catch {
    return [];
  }
}

// 北京时间当天日期串（备课/复盘的日期口径统一 UTC+8）
function beijingToday(): { today: string; now: Date } {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return { today: now.toISOString().slice(0, 10), now };
}

/** 每日备课：采集素材 → LLM 生成「知识点 + 一题」→ upsert daily_learning */
export async function generateDaily(opts: { force?: boolean } = {}): Promise<{ date: string; skipped?: string; knowledge?: string }> {
  const owner = requireAdminEnv();
  const { today, now } = beijingToday();

  // 幂等：当天已生成则跳过（force 时覆盖）
  if (!opts.force) {
    const { data: exist } = await supabaseAdmin()
      .from('daily_learning')
      .select('id')
      .eq('user_id', owner)
      .eq('date', today)
      .maybeSingle();
    if (exist) return { date: today, skipped: '今日内容已存在' };
  }

  // 采集：昨日完成任务 + 近 7 天错题科目/标签 + 未来 3 天提醒
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const in3days = new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
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

  // upsert 交给 DB 冲突解决，Cron 重投/并发重试/手动重跑都幂等
  const { error } = await supabaseAdmin()
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
  if (error) throw new Error(`写入 daily_learning 失败：${error.message}`);

  return { date: today, knowledge: String(json.knowledge_body) };
}

/** 周复盘：采集近 7 天全量 → Tavily 考纲/资讯 → LLM → upsert weekly_reviews */
export async function generateWeekly(opts: { force?: boolean } = {}): Promise<{ weekStart: string; skipped?: string; summary?: string; newsCount?: number }> {
  const owner = requireAdminEnv();
  const { now } = beijingToday();

  // 北京时间本周一
  const monday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);

  if (!opts.force) {
    const { data: exist } = await supabaseAdmin()
      .from('weekly_reviews')
      .select('id')
      .eq('user_id', owner)
      .eq('week_start', monday)
      .maybeSingle();
    if (exist) return { weekStart: monday, skipped: '本周复盘已存在' };
  }

  // 采集近 7 天全量学习数据
  const weekAgoIso = new Date(now.getTime() - 7 * 86400000 - 8 * 3600 * 1000).toISOString();
  const weekAgoDate = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const [sessions, tasks, mistakes, moods] = await Promise.all([
    supabaseAdmin().from('timer_sessions').select('duration, started_at').eq('user_id', owner).gte('started_at', weekAgoIso).limit(500),
    supabaseAdmin().from('tasks').select('content, subject, status, date').eq('user_id', owner).gte('date', weekAgoDate).limit(100),
    supabaseAdmin().from('mistakes').select('subject, tags, is_mastered, created_at').eq('user_id', owner).gte('created_at', weekAgoIso).limit(100),
    supabaseAdmin().from('mood_checkins').select('emoji_code, date, daily_summary').eq('user_id', owner).gte('date', weekAgoDate).limit(10),
  ]);

  // 专注分钟按天聚合
  const minutesByDay = new Map<string, number>();
  for (const s of sessions.data ?? []) {
    const day = new Date(s.started_at).toISOString().slice(0, 10);
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + Math.round(s.duration / 60));
  }

  const [syllabus, news] = await Promise.all([
    tavilySearch(`2026 高考 考纲 变动 题型调整`),
    tavilySearch(`2026 高考 最新 资讯 政策`),
  ]);

  const material = JSON.stringify({
    focusMinutesByDay: Object.fromEntries(minutesByDay),
    totalFocusMinutes: [...minutesByDay.values()].reduce((a, b) => a + b, 0),
    tasksDone: (tasks.data ?? []).filter((t) => t.status === 'done').length,
    tasksTotal: (tasks.data ?? []).length,
    mistakesAdded: (mistakes.data ?? []).length,
    mistakeSubjects: (mistakes.data ?? []).map((m) => m.subject),
    masteredCount: (mistakes.data ?? []).filter((m) => m.is_mastered === true).length,
    moodCheckins: moods.data ?? [],
    syllabusResults: syllabus,
  });

  const raw = await chatCompletion(
    [
      { role: 'system', content: '你是犀利但克制的高考备考教练，只输出 JSON，不输出任何其他文字。' },
      {
        role: 'user',
        content:
          '基于近 7 天学习数据与外部考纲/资讯检索结果，生成本周复盘。要求：' +
          '1) summary：本周整体表现总结（80 字内，有数据支撑）；' +
          '2) risks：薄弱点数组（2-4 条，每条一句，含下周权重建议）；' +
          '3) focusAdvice：下周专注建议（1-2 条）；' +
          '4) syllabusAlert：若检索到重大考纲/题型变动，用一句话警示，否则为 null；' +
          '5) news：从检索结果挑 3 条最有价值的资讯 [{title,url}]。' +
          '严格输出 JSON：{"summary":"","risks":[""],"focusAdvice":[""],"syllabusAlert":null,"news":[]}。' +
          `数据：${material}`,
      },
    ],
    { temperature: 0.5 }
  );

  const json = parseJsonLoose(raw);
  if (!json || !json.summary) throw new Error(`复盘生成无法解析：${raw.slice(0, 200)}`);

  const newsList = Array.isArray(json.news)
    ? (json.news as { title?: unknown; url?: unknown }[])
        .filter((n) => typeof n.title === 'string' && typeof n.url === 'string')
        .slice(0, 3)
        .map((n) => ({ title: String(n.title).slice(0, 80), url: String(n.url) }))
    : [];

  const { error } = await supabaseAdmin().from('weekly_reviews').upsert(
    {
      user_id: owner,
      week_start: monday,
      content: {
        summary: String(json.summary),
        risks: Array.isArray(json.risks) ? json.risks.map(String).slice(0, 4) : [],
        focusAdvice: Array.isArray(json.focusAdvice) ? json.focusAdvice.map(String).slice(0, 2) : [],
        syllabusAlert: json.syllabusAlert ? String(json.syllabusAlert) : null,
        news: newsList,
      },
    },
    { onConflict: 'user_id,week_start' }
  );
  if (error) throw new Error(`写入 weekly_reviews 失败：${error.message}`);

  return { weekStart: monday, summary: String(json.summary), newsCount: newsList.length };
}
