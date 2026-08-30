'use client';

import { useMemo, useState, useTransition } from 'react';
import { deleteMistake, toggleMastered } from './actions';

export interface MistakeRow {
  id: string;
  subject: string | null;
  tags: string[] | null;
  image_urls: string[] | null;
  voice_note_url: string | null;
  is_mastered: boolean | null;
  transcript?: string | null; // 列表 payload 不携带，详情弹窗按需补
  summary: string | null;
  created_at: string;
}

type MasteryFilter = 'all' | 'unmastered' | 'mastered';

// 详情弹窗的语音转写：打开时经 /api/mistakes/detail 按需加载（列表 payload 不含 transcript）
interface DetailState {
  id: string;
  text: string | null;
  loading: boolean;
}

// 错题看板：学科/掌握筛选 + 大图审阅 + 标记掌握 + 删除（server actions 落库）
export function MistakesBoard({ initial }: { initial: MistakeRow[] }) {
  const [subject, setSubject] = useState<string>('全部');
  const [mastery, setMastery] = useState<MasteryFilter>('all');
  const [viewing, setViewing] = useState<MistakeRow | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const subjects = useMemo(
    () => ['全部', ...Array.from(new Set(initial.map((m) => m.subject).filter((s): s is string => !!s)))],
    [initial]
  );

  const list = useMemo(
    () =>
      initial.filter((m) => {
        if (subject !== '全部' && m.subject !== subject) return false;
        if (mastery === 'unmastered' && m.is_mastered === true) return false;
        if (mastery === 'mastered' && m.is_mastered !== true) return false;
        return true;
      }),
    [initial, subject, mastery]
  );

  const onToggle = (m: MistakeRow) => {
    setBusyId(m.id);
    // React 18 的 transition 回调必须同步；异步体用立即执行的 async 包裹
    startTransition(() => {
      void (async () => {
        try {
          await toggleMastered(m.id, m.is_mastered);
        } finally {
          setBusyId(null);
        }
      })();
    });
  };

  // 打开详情：转写不在列表 payload 里，按 id 异步补齐（失败静默，弹窗其余功能不受影响）
  const onView = (m: MistakeRow) => {
    setViewing(m);
    setDetail({ id: m.id, text: m.transcript ?? null, loading: !m.transcript });
    void (async () => {
      try {
        const res = await fetch(`/api/mistakes/detail?id=${encodeURIComponent(m.id)}`);
        const d = (await res.json()) as { transcript?: string | null };
        setDetail((cur) => (cur?.id === m.id ? { id: m.id, text: d.transcript ?? null, loading: false } : cur));
      } catch {
        setDetail((cur) => (cur?.id === m.id ? { id: m.id, text: null, loading: false } : cur));
      }
    })();
  };

  const onDelete = (m: MistakeRow) => {
    if (!window.confirm('确定删除这道错题？图片与语音也会一并清理，不可恢复。')) return;
    setBusyId(m.id);
    startTransition(() => {
      void (async () => {
        try {
          await deleteMistake(m.id);
          setViewing((v) => (v?.id === m.id ? null : v));
        } finally {
          setBusyId(null);
        }
      })();
    });
  };

  return (
    <>
      <div className="filter-bar">
        <div className="chip-row">
          {subjects.map((s) => (
            <button key={s} className={`chip${subject === s ? ' chip-active' : ''}`} onClick={() => setSubject(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="chip-row">
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'unmastered', label: '未掌握' },
              { key: 'mastered', label: '已掌握' },
            ] as { key: MasteryFilter; label: string }[]
          ).map((o) => (
            <button key={o.key} className={`chip${mastery === o.key ? ' chip-active' : ''}`} onClick={() => setMastery(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
        <span className="filter-count">{list.length} 道</span>
        {pending && <span className="filter-pending">处理中…</span>}
      </div>

      {list.length === 0 ? (
        <div className="panel">
          <p className="placeholder">没有符合条件的错题。手机端收录后会自动同步到云端。</p>
        </div>
      ) : (
        <div className="mistake-grid">
          {list.map((m) => (
            <div key={m.id} className={`mistake-card${m.is_mastered === true ? ' mistake-mastered' : ''}`}>
              <button className="mistake-thumb" onClick={() => onView(m)} aria-label="查看大图">
                {/* 空 src 会让浏览器向当前页面自身发请求（bug），无图时渲染占位块 */}
                {m.image_urls?.[0] ? (
                  <img src={m.image_urls[0]} alt={m.subject ? `${m.subject}错题图片` : '错题图片'} loading="lazy" />
                ) : (
                  <span className="mistake-thumb-empty">📷 无图片</span>
                )}
              </button>
              <div className="mistake-meta">
                <div className="mistake-line">
                  <span className="badge">{m.subject ?? '未分类'}</span>
                  <span className={`badge ${m.is_mastered === true ? 'badge-green' : 'badge-red'}`}>
                    {m.is_mastered === true ? '✅ 已掌握' : m.is_mastered === false ? '❌ 仍错' : '未重做'}
                  </span>
                </div>
                {m.summary && <p className="mistake-summary">{m.summary}</p>}
                {(m.tags ?? []).length > 0 && (
                  <div className="tag-row">
                    {(m.tags ?? []).slice(0, 4).map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mistake-foot">
                  <span className="mistake-date">{m.created_at.slice(0, 10)}</span>
                  <span className="mistake-actions">
                    <button className="btn btn-sm" onClick={() => onToggle(m)} disabled={busyId === m.id}>
                      {m.is_mastered === true ? '取消掌握' : '标记掌握'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => onDelete(m)} disabled={busyId === m.id}>
                      删除
                    </button>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <MistakeLightbox
          m={viewing}
          detail={detail}
          onClose={() => setViewing(null)}
          onToggle={onToggle}
          onDelete={onDelete}
          busy={busyId === viewing.id}
        />
      )}
    </>
  );
}

// 大图审阅：图片全览 + 语音反思播放（按需加载）+ AI 识别摘要 + 操作
function MistakeLightbox({
  m,
  detail,
  onClose,
  onToggle,
  onDelete,
  busy,
}: {
  m: MistakeRow;
  detail: DetailState | null;
  onClose: () => void;
  onToggle: (m: MistakeRow) => void;
  onDelete: (m: MistakeRow) => void;
  busy: boolean;
}) {
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label="错题详情">
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-media">
          {(m.image_urls ?? []).map((u, i) => (
            <img key={i} src={u} alt={`错题图片 ${i + 1}`} />
          ))}
        </div>
        <div className="lightbox-side">
          <div className="mistake-line">
            <span className="badge">{m.subject ?? '未分类'}</span>
            <span className={`badge ${m.is_mastered === true ? 'badge-green' : 'badge-red'}`}>
              {m.is_mastered === true ? '✅ 已掌握' : m.is_mastered === false ? '❌ 仍错' : '未重做'}
            </span>
            <span className="mistake-date">{m.created_at.slice(0, 10)}</span>
          </div>
          {m.summary && (
            <div className="side-block">
              <h3>题面摘要（AI 识别）</h3>
              <p>{m.summary}</p>
            </div>
          )}
          {detail?.loading ? (
            <div className="side-block">
              <h3>语音反思转写</h3>
              <p className="placeholder">加载中…</p>
            </div>
          ) : (
            detail?.text && (
              <div className="side-block">
                <h3>语音反思转写</h3>
                <p className="transcript">{detail.text}</p>
              </div>
            )
          )}
          {(m.tags ?? []).length > 0 && (
            <div className="side-block">
              <h3>卡壳标签</h3>
              <div className="tag-row">
                {(m.tags ?? []).map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {m.voice_note_url && (
            <div className="side-block">
              <h3>语音反思</h3>
              <audio controls src={m.voice_note_url} style={{ width: '100%' }} />
            </div>
          )}
          <div className="lightbox-actions">
            <button className="btn" onClick={() => onToggle(m)} disabled={busy}>
              {m.is_mastered === true ? '取消掌握' : '标记掌握'}
            </button>
            <button className="btn btn-danger" onClick={() => onDelete(m)} disabled={busy}>
              删除
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
