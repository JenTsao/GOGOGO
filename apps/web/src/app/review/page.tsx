import { supabaseAdmin, requireAdminEnv } from '@/lib/supabaseAdmin';
import { RegenButtons } from './RegenButtons';

export const dynamic = 'force-dynamic';

interface DailyRow {
  date: string;
  knowledge_body: string | null;
  question_text: string | null;
  answer: string | null;
}

interface WeeklyRow {
  week_start: string;
  content: {
    summary?: string;
    risks?: string[];
    focusAdvice?: string[];
    syllabusAlert?: string | null;
    news?: { title: string; url: string }[];
  };
}

// 每日备课 + 周复盘阅读页：cron 产物在这里阅读，也可手动触发/重新生成
export default async function ReviewPage() {
  let dailies: DailyRow[] = [];
  let weeklies: WeeklyRow[] = [];
  let error: string | null = null;
  try {
    const owner = requireAdminEnv();
    const [d, w] = await Promise.all([
      supabaseAdmin()
        .from('daily_learning')
        .select('date, knowledge_body, question_text, answer')
        .eq('user_id', owner)
        .order('date', { ascending: false })
        .limit(14),
      supabaseAdmin()
        .from('weekly_reviews')
        .select('week_start, content')
        .eq('user_id', owner)
        .order('week_start', { ascending: false })
        .limit(12),
    ]);
    if (d.error) throw new Error(d.error.message);
    if (w.error) throw new Error(w.error.message);
    dailies = (d.data ?? []) as DailyRow[];
    weeklies = (w.data ?? []) as WeeklyRow[];
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <>
      <h1 className="page-title">每日复盘</h1>

      <div className="panel">
        <div className="panel-head">
          <h2>生成控制</h2>
        </div>
        <p className="placeholder">
          自动生成：备课 04:00 / 复盘周一 04:30（北京时间）。改配置或环境变量后，可在此手动触发。
        </p>
        <RegenButtons />
      </div>

      {error && (
        <div className="panel">
          <p className="placeholder">云端数据不可用：{error}</p>
        </div>
      )}

      {!error && (
        <>
          <h2 className="section-title">每日备课（近 14 天）</h2>
          {dailies.length === 0 ? (
            <div className="panel">
              <p className="placeholder">还没有备课记录。点上方「生成今日备课」立即跑一次流水线。</p>
            </div>
          ) : (
            dailies.map((d) => (
              <div key={d.date} className="panel">
                <div className="panel-head">
                  <h2>{d.date}</h2>
                </div>
                {d.knowledge_body && (
                  <div className="daily-block">
                    <h3>📘 今日知识点</h3>
                    <p className="review-summary">{d.knowledge_body}</p>
                  </div>
                )}
                {d.question_text && (
                  <div className="daily-block">
                    <h3>✏️ 每日一题</h3>
                    <p className="review-summary">{d.question_text}</p>
                    {d.answer && (
                      <details className="answer-details">
                        <summary>查看参考解析</summary>
                        <p className="review-summary">{d.answer}</p>
                      </details>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          <h2 className="section-title">周复盘</h2>
          {weeklies.length === 0 ? (
            <div className="panel">
              <p className="placeholder">还没有周复盘。点上方「生成本周复盘」立即跑一次流水线。</p>
            </div>
          ) : (
            weeklies.map((w) => (
              <div key={w.week_start} className="panel">
                <div className="panel-head">
                  <h2>{w.week_start} 那一周</h2>
                </div>
                {w.content?.syllabusAlert && <p className="risk-line">🚨 考纲警示：{w.content.syllabusAlert}</p>}
                <p className="review-summary">{w.content?.summary ?? '（无总结）'}</p>
                {(w.content?.risks ?? []).length > 0 && (
                  <div className="daily-block">
                    <h3>⚠ 薄弱点与权重建议</h3>
                    {(w.content?.risks ?? []).map((r, i) => (
                      <p key={i} className="risk-line">
                        {r}
                      </p>
                    ))}
                  </div>
                )}
                {(w.content?.focusAdvice ?? []).length > 0 && (
                  <div className="daily-block">
                    <h3>🎯 下周专注建议</h3>
                    {(w.content?.focusAdvice ?? []).map((r, i) => (
                      <p key={i} className="review-summary">
                        {r}
                      </p>
                    ))}
                  </div>
                )}
                {(w.content?.news ?? []).length > 0 && (
                  <div className="daily-block">
                    <h3>📰 高考资讯</h3>
                    <ul className="news-list">
                      {(w.content?.news ?? []).map((n, i) => (
                        <li key={i}>
                          <a href={n.url} target="_blank" rel="noreferrer">
                            {n.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}
    </>
  );
}
