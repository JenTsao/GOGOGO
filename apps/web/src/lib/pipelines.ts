import { chatCompletion, parseJsonLoose } from '@/lib/llm';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchRepoTree, fetchRawFile, isGithubConfigured } from '@/lib/github';
import { QUESTION_SUBJECTS, type QuestionSubject } from '@/lib/questionSubjects';
import { buildUserPrompt } from '@/lib/promptBudget';

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
    // started_at 是 UTC（timestamptz），+8h 归一到北京日期口径，否则 00:00–07:59 的专注会被算进前一天
    const day = new Date(new Date(s.started_at).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
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

// ============================================================
// 每日猜题：知识库考点锚 + 外部时文素材 → LLM 命题 → upsert daily_questions
// 科目清单与命题规格见 lib/questionSubjects.ts（新增科目只加一条定义）
// ============================================================

const ARTICLE_MAX_CHARS = 6000; // 命题素材抓取阶段截断（字符口径，预算装配前粗筛）
const NOTE_ANCHOR_CHARS = 2000; // 单篇知识库锚点截断
const NOTE_ANCHOR_COUNT = 3; // 每次最多取 3 篇笔记作考点锚
const QUESTION_PROMPT_BUDGET = 6000; // 命题 user prompt 总预算（tokens，≈12000 字符）：
// 优先级注入（提示词预算模型）：材料 priority=2 先占预算，知识库锚点 priority=1 用剩余空间，
// 预算不足时锚点先被截断/丢弃而材料保全——材料是命题根基，锚点只是辅助定向

interface FetchedArticle {
  title: string;
  url: string;
  content: string;
}

// Tavily 全文检索：include_raw_content 拿文章正文（tavilySearch 的 150 字 snippet 不够命题用）。
// Key 未配置 / 无合格全文 → null（调用方降级为 AI 自拟材料）
async function fetchArticle(query: string): Promise<FetchedArticle | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key || !query) return null;
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: 4,
        search_depth: 'basic',
        include_raw_content: true,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { title: string; url: string; raw_content?: string | null; content?: string }[];
    };
    // 只接受正文够长的结果：太短的页面撑不起一套阅读题
    for (const r of data.results ?? []) {
      const body = (r.raw_content ?? '').trim();
      if (body.length >= 500) {
        return { title: r.title, url: r.url, content: body.slice(0, ARTICLE_MAX_CHARS) };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// 知识库考点锚：按科目关键词在笔记路径里筛候选，随机取几篇（每天自然轮换）。
// GitHub 未配置 / 无命中 / 读取失败 → 空串（命题 prompt 降级为高考高频考点）
async function pickNoteAnchors(keywords: string[]): Promise<string> {
  if (!isGithubConfigured() || keywords.length === 0) return '';
  try {
    const { entries } = await fetchRepoTree();
    const candidates = entries.filter((e) =>
      keywords.some((k) => e.path.toLowerCase().includes(k.toLowerCase()))
    );
    if (candidates.length === 0) return '';
    const picked = [...candidates].sort(() => Math.random() - 0.5).slice(0, NOTE_ANCHOR_COUNT);
    const anchors = await Promise.all(
      picked.map(async (e) => {
        const text = await fetchRawFile(e.path).catch(() => '');
        if (!text) return '';
        return `【考点笔记：${e.path}】\n${text.slice(0, NOTE_ANCHOR_CHARS)}`;
      })
    );
    return anchors.filter(Boolean).join('\n\n');
  } catch {
    return '';
  }
}

export interface QuestionSubjectResult {
  subject: string;
  status: 'done' | 'skipped' | 'failed';
  detail?: string;
}

/** 每日猜题流水线：逐科目执行，单科目失败不影响其他科目 */
export async function generateDailyQuestions(opts: { force?: boolean } = {}): Promise<{
  date: string;
  results: QuestionSubjectResult[];
}> {
  const owner = requireAdminEnv();
  const { today } = beijingToday();
  const results: QuestionSubjectResult[] = [];

  for (const subj of QUESTION_SUBJECTS) {
    try {
      results.push(await generateOneSubject(owner, today, subj, opts.force === true));
    } catch (e) {
      results.push({ subject: subj.subject, status: 'failed', detail: (e as Error).message });
    }
  }
  return { date: today, results };
}

async function generateOneSubject(
  owner: string,
  date: string,
  subj: QuestionSubject,
  force: boolean
): Promise<QuestionSubjectResult> {
  // 幂等按科目检查：单科目重跑不会覆盖其他科目的产物
  if (!force) {
    const { data: exist } = await supabaseAdmin()
      .from('daily_questions')
      .select('id')
      .eq('user_id', owner)
      .eq('date', date)
      .eq('subject', subj.subject)
      .maybeSingle();
    if (exist) return { subject: subj.subject, status: 'skipped', detail: '已存在' };
  }

  // 采集：外部时文（可降级 AI 自拟）+ 知识库考点锚（可空）
  const [article, noteAnchors] = await Promise.all([
    fetchArticle(subj.searchQuery),
    pickNoteAnchors(subj.noteKeywords),
  ]);

  const specAndContract =
    `${subj.questionSpec}\n\nJSON 字段契约：` +
    `questions 数组每项 {type, stem, options?, answer?, analysis}；结尾 tip 为今日考点点评（60 字内）。`;

  // 提示词预算装配（promptBudget）：外部素材原文是不可截断核心输入；AI 自拟指令进 prefix；
  // 知识库锚点按剩余预算注入，超预算先截锚点保材料（材料是命题根基）
  const fallbackNote = noteAnchors ? '' : '\n\n知识库未提供考点锚，按高考高频考点命题。';
  const prefix = article
    ? `${specAndContract}\n\n命题材料（真实时文，题目须严格基于此文）\n标题：${article.title}`
    : `${specAndContract}\n\n今日未抓取到合格外部素材。请自拟一篇符合以下口径的命题材料（350-800 字），` +
      `连同材料一起放进返回 JSON 的 material 字段，另附材料标题在 material_title 字段。选材口径：${subj.sourceLabel}。` +
      fallbackNote;

  const prompt = buildUserPrompt({
    prefix,
    input: article ? article.content : '',
    sections: noteAnchors
      ? [{ key: 'noteAnchors', priority: 1, content: `知识库考点锚（命题时优先贴合这些笔记覆盖的考点）：\n${noteAnchors}` }]
      : [],
    maxTokens: QUESTION_PROMPT_BUDGET,
  });

  const raw = await chatCompletion(
    [
      { role: 'system', content: subj.systemPrompt },
      { role: 'user', content: prompt.text },
    ],
    { temperature: 0.6 }
  );

  const json = parseJsonLoose(raw);
  const questions = Array.isArray(json?.questions) ? json.questions : [];
  if (!json || questions.length === 0) {
    throw new Error(`命题结果无法解析：${raw.slice(0, 200)}`);
  }

  // 外部素材直接落库原文（不经 LLM 复述，防失真）；AI 自拟时取 LLM 返回的 material
  const material = article ? article.content : String(json.material ?? '');
  if (!material) throw new Error('缺少命题材料（外部抓取失败且 AI 未返回自拟材料）');

  const { error } = await supabaseAdmin()
    .from('daily_questions')
    .upsert(
      {
        user_id: owner,
        date,
        subject: subj.subject,
        material_title: article ? article.title.slice(0, 200) : String(json.material_title ?? `${date} ${subj.subject}命题材料`).slice(0, 200),
        material_source: article ? article.url : 'AI 生成',
        content: {
          material,
          questions: questions.slice(0, 12),
          tip: json.tip ? String(json.tip) : '',
        },
      },
      { onConflict: 'user_id,date,subject' }
    );
  if (error) throw new Error(`写入 daily_questions 失败：${error.message}`);

  return { subject: subj.subject, status: 'done' };
}
