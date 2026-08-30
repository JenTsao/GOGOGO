import Link from 'next/link';
import { supabaseAdmin, requireAdminEnv } from '@/lib/supabaseAdmin';
import { Countdown } from '@/components/Countdown';
import { daysToGaokaoBJ, jayEggForToday, jayMilestoneEgg, jayWeeklyEgg } from '@/lib/jayEggs';

export const dynamic = 'force-dynamic';

// 总览首页：单用户驾驶舱——倒计时 / 今日专注 / 任务 / 错题 / 最新复盘 / 今日备课
// 服务端直查（service role + OWNER 归属），云端未配置时优雅降级为引导面板

function beijingToday(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

interface OverviewData {
  todayFocusMin: number;
  weekFocusMin: number;
  todayTasksDone: number;
  todayTasksTotal: number;
  mistakeTotal: number;
  mistakeUnmastered: number;
  weekly: { week_start: string; content: { summary?: string; risks?: string[] } } | null;
  dailyReady: boolean;
}

async function loadOverview(): Promise<OverviewData> {
  const owner = requireAdminEnv();
  const today = beijingToday();
  const todayIso = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  const weekAgoIso = new Date(Date.now() + 8 * 3600 * 1000 - 7 * 86400000).toISOString();

  const [todaySessions, weekSessions, tasks, mistakeTotal, mistakeUnmastered, weekly, daily] = await Promise.all([
    supabaseAdmin()
      .from('timer_sessions')
      .select('duration')
      .eq('user_id', owner)
      .gte('started_at', todayIso)
      .limit(200),
    supabaseAdmin()
      .from('timer_sessions')
      .select('duration')
      .eq('user_id', owner)
      .gte('started_at', weekAgoIso)
      .limit(500),
    supabaseAdmin()
      .from('tasks')
      .select('status')
      .eq('user_id', owner)
      .eq('date', today)
      .limit(50),
    // 计数用 head 请求（count: exact, head: true）：不拉行数据，替代原「拉 2000 行内存计数」
    supabaseAdmin()
      .from('mistakes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner),
    supabaseAdmin()
      .from('mistakes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner)
      .neq('is_mastered', true),
    supabaseAdmin()
      .from('weekly_reviews')
      .select('week_start, content')
      .eq('user_id', owner)
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin()
      .from('daily_learning')
      .select('id')
      .eq('user_id', owner)
      .eq('date', today)
      .maybeSingle(),
  ]);

  return {
    todayFocusMin: Math.round((todaySessions.data ?? []).reduce((s, x) => s + x.duration, 0) / 60),
    weekFocusMin: Math.round((weekSessions.data ?? []).reduce((s, x) => s + x.duration, 0) / 60),
    todayTasksDone: (tasks.data ?? []).filter((t) => t.status === 'done').length,
    todayTasksTotal: (tasks.data ?? []).length,
    mistakeTotal: mistakeTotal.count ?? 0,
    // neq true 会让 is_mastered 为 NULL（未重做）的行也计入未掌握，与旧内存口径一致
    mistakeUnmastered: mistakeUnmastered.count ?? 0,
    weekly: (weekly.data as OverviewData['weekly']) ?? null,
    dailyReady: !!daily.data,
  };
}

export default async function OverviewPage() {
  let data: OverviewData | null = null;
  let cloudError: string | null = null;
  try {
    data = await loadOverview();
  } catch (e) {
    cloudError = (e as Error).message;
  }

  if (!data) {
    return (
      <>
        <h1 className="page-title">总览</h1>
        <div className="panel">
          <p className="placeholder">
            云端数据不可用：{cloudError}
            <br />
            请在 Vercel / .env.local 配置 SUPABASE_SERVICE_ROLE_KEY 与 OWNER_USER_ID 后刷新。
          </p>
        </div>
      </>
    );
  }

  const w = data.weekly?.content;
  // 周杰伦彩蛋：特定日期 > 倒计时里程碑 > 周一开课，命中才显示（与移动端驾驶舱问候语同源）
  const egg = jayEggForToday() ?? jayMilestoneEgg(daysToGaokaoBJ()) ?? jayWeeklyEgg();

  return (
    <>
      <h1 className="page-title">总览</h1>
      {egg && <p className="egg-line">{egg}</p>}

      <div className="stat-grid">
        <div className="panel stat-card">
          <div className="stat-label">距离高考</div>
          <Countdown />
        </div>
        <div className="panel stat-card">
          <div className="stat-label">今日专注</div>
          <div className="stat-num">
            {data.todayFocusMin}
            <span className="stat-unit"> 分钟</span>
          </div>
          <div className="stat-sub">近 7 天 {data.weekFocusMin} 分钟</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">今日任务</div>
          <div className="stat-num">
            {data.todayTasksDone}
            <span className="stat-unit"> / {data.todayTasksTotal}</span>
          </div>
          <div className="stat-sub">三件事 + 后备箱完成情况</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">错题本</div>
          <div className="stat-num">
            {data.mistakeTotal}
            <span className="stat-unit"> 道</span>
          </div>
          <div className="stat-sub">
            未掌握 <b>{data.mistakeUnmastered}</b> 道 ·{' '}
            <Link href="/mistakes" className="stat-link">
              去复习 →
            </Link>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <div className="panel-head">
            <h2>最新周复盘</h2>
            <Link href="/review" className="panel-link">
              全部复盘 →
            </Link>
          </div>
          {w ? (
            <>
              <p className="muted-line">{data.weekly!.week_start} 那一周</p>
              <p className="review-summary">{w.summary ?? '（无总结）'}</p>
              {(w.risks ?? []).slice(0, 2).map((r, i) => (
                <p key={i} className="risk-line">
                  ⚠ {r}
                </p>
              ))}
            </>
          ) : (
            <p className="placeholder">还没有周复盘（每周一 04:30 自动生成，或到「每日复盘」手动触发）。</p>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>今日备课</h2>
            <Link href="/review" className="panel-link">
              去查看 →
            </Link>
          </div>
          {data.dailyReady ? (
            <p className="review-summary">今日的知识点与一题已生成完毕，去「每日复盘」页阅读。</p>
          ) : (
            <p className="placeholder">
              今日内容尚未生成（每日 04:00 自动生成，或到「每日复盘」手动触发）。
            </p>
          )}
        </div>
      </div>
    </>
  );
}
