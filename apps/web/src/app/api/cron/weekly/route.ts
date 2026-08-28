import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion, parseJsonLoose } from '@/lib/llm';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface NewsItem {
  title: string;
  url: string;
  snippet: string;
}

// Tavily 资讯检索（蓝皮书：替代 MCP 的外界信息同步管道）。Key 未配置时返回空（降级为纯本地复盘）
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

// 每周画像复盘 + 资讯自动检索（Vercel Cron 每周一 04:30 北京时间，见 vercel.json）
// 蓝皮书第四章管道 2/3：采集近 7 天全量学习数据 → Tavily 抓考纲变动/资讯 → LLM 生成周复盘 → weekly_reviews
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: '未配置 CRON_SECRET，已拒绝执行' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const owner = requireAdminEnv();

    // 北京时间本周一
    const now = new Date(Date.now() + 8 * 3600 * 1000);
    const monday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);

    // 幂等：本周已复盘则跳过
    const { data: exist } = await supabaseAdmin()
      .from('weekly_reviews')
      .select('id')
      .eq('user_id', owner)
      .eq('week_start', monday)
      .maybeSingle();
    if (exist) return NextResponse.json({ ok: true, skipped: '本周复盘已存在', weekStart: monday });

    // ---------- 采集近 7 天全量学习数据 ----------
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

    // ---------- Tavily：考纲变动 + 高考资讯（蓝皮书注入画像管道） ----------
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

    const { error: insertErr } = await supabaseAdmin().from('weekly_reviews').upsert(
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
    if (insertErr) throw new Error(`写入 weekly_reviews 失败：${insertErr.message}`);

    return NextResponse.json({ ok: true, weekStart: monday, summary: String(json.summary), newsCount: newsList.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
