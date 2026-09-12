import { supabaseAdmin, requireAdminEnv } from '@/lib/supabaseAdmin';
import { renderMarkdown } from '@/lib/markdown';
import { QUESTION_SUBJECTS } from '@/lib/questionSubjects';
import { QuestionRegenButtons } from './QuestionRegenButtons';

export const dynamic = 'force-dynamic';

interface QuestionItem {
  type: string;
  stem: string;
  options?: string[];
  answer?: string;
  analysis?: string;
}

interface QuestionRow {
  date: string;
  subject: string;
  material_title: string | null;
  material_source: string | null;
  content: { material?: string; questions?: QuestionItem[]; tip?: string };
}

const SUBJECT_ICONS = new Map(QUESTION_SUBJECTS.map((s) => [s.subject, s.icon]));

// 渲染一篇材料：正文 Markdown + 来源标注
function Material({ row }: { row: QuestionRow }) {
  const source = row.material_source ?? '';
  const isUrl = /^https?:\/\//.test(source);
  return (
    <div className="q-material">
      <div className="q-material-head">
        <span className="q-material-title">{row.material_title ?? '命题材料'}</span>
        {source && (
          <span className="q-material-source">
            来源：
            {isUrl ? (
              <a href={source} target="_blank" rel="noreferrer">
                {source.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
              </a>
            ) : (
              source
            )}
          </span>
        )}
      </div>
      {row.content.material && (
        // renderMarkdown 内 html:false 防注入，与知识库阅读区同一安全模式
        <div className="q-material-body lib-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(row.content.material) }} />
      )}
    </div>
  );
}

function QuestionCard({ q, index }: { q: QuestionItem; index: number }) {
  const isEssay = q.type === '作文';
  return (
    <div className="q-card">
      <div className="q-card-head">
        <span className="badge">{q.type}</span>
        <span className="q-card-no">第 {index} 题</span>
      </div>
      <div className="q-stem lib-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.stem ?? '') }} />
      {q.options && q.options.length > 0 && (
        <ol className="q-options" type="A">
          {q.options.map((opt, i) => (
            <li key={i}>{opt}</li>
          ))}
        </ol>
      )}
      {!isEssay && (q.answer || q.analysis) && (
        <details className="q-answer">
          <summary>查看答案与解析</summary>
          {q.answer && (
            <div className="q-answer-line">
              <b>答案：</b>
              {q.answer}
            </div>
          )}
          {q.analysis && (
            // renderMarkdown 内 html:false 防注入
            <div className="q-analysis lib-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.analysis) }} />
          )}
        </details>
      )}
      {isEssay && q.analysis && (
        <details className="q-answer">
          <summary>查看审题立意指导</summary>
          <div className="q-analysis lib-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.analysis) }} />
        </details>
      )}
    </div>
  );
}

// 每日猜题：知识库考点锚 + 外部时文素材 → LLM 命题（流水线产物阅读页）
export default async function QuestionsPage() {
  let rows: QuestionRow[] = [];
  let error: string | null = null;
  try {
    const owner = requireAdminEnv();
    const { data, error: dbErr } = await supabaseAdmin()
      .from('daily_questions')
      .select('date, subject, material_title, material_source, content')
      .eq('user_id', owner)
      .order('date', { ascending: false })
      .limit(42); // 14 天 × 3 科目余量
    if (dbErr) throw new Error(dbErr.message);
    rows = (data ?? []) as QuestionRow[];
  } catch (e) {
    error = (e as Error).message;
  }

  // 按日期分组（保持日期降序）
  const byDate = new Map<string, QuestionRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }

  return (
    <>
      <h1 className="page-title">每日猜题</h1>

      <div className="panel">
        <div className="panel-head">
          <h2>生成控制</h2>
        </div>
        <p className="placeholder">
          自动生成：每天 04:20（北京时间）按科目流水线出题 —— 外部时文检索（语文取人民日报等时评、英语取新闻语料）→
          知识库笔记作考点锚 → LLM 命题。未配置 TAVILY_API_KEY 时自动降级为 AI 自拟材料。
        </p>
        <QuestionRegenButtons />
      </div>

      {error && (
        <div className="panel">
          <p className="placeholder">云端数据不可用：{error}</p>
        </div>
      )}

      {!error && byDate.size === 0 && (
        <div className="panel">
          <p className="placeholder">还没有猜题记录。点上方「生成今日猜题」立即跑一次流水线。</p>
        </div>
      )}

      {[...byDate.entries()].map(([date, list]) => (
        <div key={date} className="q-day">
          <h2 className="section-title">{date}</h2>
          {list.map((row) => {
            const questions = row.content.questions ?? [];
            return (
              <div className="panel" key={`${row.date}-${row.subject}`}>
                <div className="panel-head">
                  <h2>
                    {SUBJECT_ICONS.get(row.subject) ?? '📝'} {row.subject} · 今日猜题
                  </h2>
                  <span className="badge">{questions.length} 题</span>
                </div>
                <Material row={row} />
                <div className="q-list">
                  {questions.map((q, i) => (
                    <QuestionCard key={i} q={q} index={i + 1} />
                  ))}
                </div>
                {row.content.tip && <p className="q-tip">💡 {row.content.tip}</p>}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
