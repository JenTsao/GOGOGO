import { supabaseAdmin, requireAdminEnv } from '@/lib/supabaseAdmin';
import { InsightCharts, type InsightData } from './Charts';

export const dynamic = 'force-dynamic';

// 画像大屏：近 30 天专注/任务/情绪/错题重做 → 六维雷达与趋势（recharts 客户端渲染）
// 服务端聚合好再传客户端，图表组件只负责画

function beijingToday(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 情绪 5 档 → 分值（-2..+2），未识别的 emoji 返回 null（图表跳过）
const MOOD_SCALE = ['😔', '🙁', '😐', '🙂', '😄'];
function moodScore(code: string | null): number | null {
  if (!code) return null;
  if (/^[1-5]$/.test(code)) return Number(code) - 3;
  const idx = MOOD_SCALE.indexOf(code);
  return idx >= 0 ? idx - 2 : null;
}

async function loadInsights(): Promise<InsightData> {
  const owner = requireAdminEnv();
  const nowBj = Date.now() + 8 * 3600 * 1000;
  const today = beijingToday();
  const d30Iso = new Date(nowBj - 30 * 86400000).toISOString();
  const d7Iso = new Date(nowBj - 7 * 86400000).toISOString();
  const d14Iso = new Date(nowBj - 14 * 86400000).toISOString();
  const d30Date = new Date(nowBj - 30 * 86400000).toISOString().slice(0, 10);
  const d7Date = new Date(nowBj - 7 * 86400000).toISOString().slice(0, 10);

  const [sessions, tasks, moods, mistakes, notes] = await Promise.all([
    supabaseAdmin().from('timer_sessions').select('duration, started_at').eq('user_id', owner).gte('started_at', d30Iso).limit(2000),
    supabaseAdmin().from('tasks').select('status, date').eq('user_id', owner).gte('date', d30Date).limit(500),
    supabaseAdmin().from('mood_checkins').select('emoji_code, date, daily_summary').eq('user_id', owner).gte('date', d30Date).order('date', { ascending: true }).limit(31),
    supabaseAdmin().from('mistakes').select('is_mastered').eq('user_id', owner).limit(2000),
    supabaseAdmin().from('obsidian_metadata').select('id').eq('user_id', owner).limit(1000),
  ]);

  // ---- 专注：按天聚合（近 30 天连续序列） ----
  const minutesByDay = new Map<string, number>();
  const sessionLens: number[] = [];
  for (const s of sessions.data ?? []) {
    const day = new Date(new Date(s.started_at).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + Math.round(s.duration / 60));
    sessionLens.push(Math.round(s.duration / 60));
  }
  const focusTrend: { date: string; minutes: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(nowBj - i * 86400000).toISOString().slice(0, 10);
    focusTrend.push({ date: day.slice(5), minutes: minutesByDay.get(day) ?? 0 });
  }

  const weekMin = [...minutesByDay.entries()].filter(([d]) => d >= d7Date).reduce((s, [, m]) => s + m, 0);
  const avgSession = sessionLens.length ? sessionLens.reduce((a, b) => a + b, 0) / sessionLens.length : 0;
  const activeDays14 = new Set(
    [...minutesByDay.keys()].filter((d) => d >= new Date(nowBj - 14 * 86400000).toISOString().slice(0, 10))
  ).size;

  // ---- 任务：近 7 天完成率 ----
  const weekTasks = (tasks.data ?? []).filter((t) => t.date && t.date >= d7Date);
  const doneWeek = weekTasks.filter((t) => t.status === 'done').length;

  // ---- 错题重做正确率（学科掌握） ----
  const graded = (mistakes.data ?? []).filter((m) => m.is_mastered !== null);
  const mastered = graded.filter((m) => m.is_mastered === true).length;

  // ---- 六维雷达（0-100，口径对齐移动端语义） ----
  const radar = [
    { dim: '专注投入', score: Math.min(100, Math.round((weekMin / 300) * 100)) },
    { dim: '专注深度', score: Math.min(100, Math.round((avgSession / 45) * 100)) },
    { dim: '坚持天数', score: Math.round((activeDays14 / 14) * 100) },
    { dim: '任务执行', score: Math.round((doneWeek / Math.max(1, weekTasks.length)) * 100) },
    { dim: '知识积累', score: Math.min(100, Math.round(((notes.data ?? []).length / 80) * 100)) },
    { dim: '学科掌握', score: graded.length ? Math.round((mastered / graded.length) * 100) : 0 },
  ];

  // ---- 情绪轨迹 ----
  const moodTrend = (moods.data ?? [])
    .map((m) => ({ date: (m.date ?? '').slice(5), score: moodScore(m.emoji_code), emoji: m.emoji_code ?? '' }))
    .filter((x) => x.score !== null) as { date: string; score: number; emoji: string }[];

  return {
    radar,
    focusTrend,
    moodTrend,
    totals: {
      weekMin,
      avgSession: Math.round(avgSession),
      activeDays14,
      doneWeek,
      weekTasks: weekTasks.length,
      mistakeTotal: (mistakes.data ?? []).length,
      mastered,
      graded: graded.length,
      notes: (notes.data ?? []).length,
    },
  };
}

export default async function InsightsPage() {
  let data: InsightData | null = null;
  let error: string | null = null;
  try {
    data = await loadInsights();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <>
      <h1 className="page-title">画像大屏</h1>
      {error || !data ? (
        <div className="panel">
          <p className="placeholder">云端数据不可用：{error ?? '未知错误'}</p>
        </div>
      ) : (
        <InsightCharts data={data} />
      )}
    </>
  );
}
