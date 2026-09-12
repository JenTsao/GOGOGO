'use client';

import { useCallback, useEffect, useState } from 'react';

export interface MaterialRow {
  id: number;
  source_name: string;
  category: string;
  subject: string;
  url: string;
  title: string | null;
  published_at: string | null;
  word_count: number | null;
  summary_zh: string | null;
  gaokao_fit: number | string | null;
  topic: string | null;
  genre: string | null;
  difficulty: string | null;
  risk: string | null;
  form: string | null;
  status: string;
  selected_on: string | null;
  created_at: string;
}

const CATEGORIES = [
  { key: '', label: '全部' },
  { key: 'serious-media', label: '严肃媒体 45%' },
  { key: 'professional', label: '专业刊物 16%' },
  { key: 'lifestyle', label: '生活信息 26%' },
  { key: 'tabloid', label: '都市小报 13%' },
];

const FIT_OPTIONS = [
  { key: 0, label: '不限' },
  { key: 7, label: '≥7 优质' },
  { key: 5, label: '≥5 可用' },
];

interface VerifyResult {
  name: string;
  url: string;
  ok: boolean;
  items: number;
  error?: string;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toISOString().slice(0, 10);
}

function fitNum(v: number | string | null): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 素材池：采集（手动）+ 源验证 + 筛选浏览。
 * 手动采集默认 12 条（控 LLM 成本与函数时长），全量靠每日 cron。
 */
export function MaterialPool({ initial }: { initial: MaterialRow[] }) {
  const [rows, setRows] = useState<MaterialRow[]>(initial);
  const [category, setCategory] = useState('');
  const [minFit, setMinFit] = useState(0);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [verify, setVerify] = useState<VerifyResult[] | null>(null);

  const reload = useCallback(async () => {
    const sp = new URLSearchParams();
    if (category) sp.set('category', category);
    if (minFit) sp.set('minFit', String(minFit));
    sp.set('limit', '100');
    const res = await fetch(`/api/materials?${sp.toString()}`);
    const data = (await res.json()) as { materials?: MaterialRow[]; error?: string };
    if (data.materials) setRows(data.materials);
  }, [category, minFit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function collect(skipScoring: boolean) {
    setBusy(skipScoring ? 'fast' : 'collect');
    setMsg('');
    setErr('');
    try {
      const res = await fetch('/api/materials?action=collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPerRun: 12, skipScoring }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        inserted?: number;
        fetched?: number;
        scored?: number;
        skippedExisting?: number;
        llmEnabled?: boolean;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMsg(
        `抓取 ${data.fetched ?? 0} 条，入库 ${data.inserted ?? 0} 条` +
          (data.llmEnabled ? `（已打分 ${data.scored ?? 0} 条）` : '（未打分：LLM Key 未配置）') +
          `，跳过已存在 ${data.skippedExisting ?? 0} 条`
      );
      await reload();
    } catch (e) {
      setErr(`采集失败：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function verifySources() {
    setBusy('verify');
    setErr('');
    try {
      const res = await fetch('/api/materials?action=verify', { method: 'POST' });
      const data = (await res.json()) as {
        ok?: boolean;
        sources?: VerifyResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setVerify(data.sources ?? []);
    } catch (e) {
      setErr(`验证失败：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>素材列表</h2>
        <span className="filter-count">{rows.length} 条</span>
      </div>

      <div className="filter-bar">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => collect(false)}
          disabled={busy !== ''}
        >
          {busy === 'collect' ? '采集中…' : '立即采集（12 条）'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => collect(true)}
          disabled={busy !== ''}
          title="只抓取入库、不调用 LLM 打分，用于快速补量"
        >
          {busy === 'fast' ? '采集中…' : '快速采集（不打分）'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={verifySources}
          disabled={busy !== ''}
        >
          {busy === 'verify' ? '验证中…' : '验证源可用性'}
        </button>
      </div>

      <div className="filter-bar">
        <span className="muted-line" style={{ margin: 0 }}>来源组</span>
        <div className="chip-row">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`chip${category === c.key ? ' chip-active' : ''}`}
              onClick={() => setCategory(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-bar">
        <span className="muted-line" style={{ margin: 0 }}>适配度</span>
        <div className="chip-row">
          {FIT_OPTIONS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip${minFit === f.key ? ' chip-active' : ''}`}
              onClick={() => setMinFit(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="muted-line" style={{ color: 'var(--green-deep)' }}>{msg}</p>}
      {err && <p className="risk-line">{err}</p>}

      {verify && (
        <div style={{ margin: '12px 0' }}>
          <p className="muted-line">源验证结果（0 条或非 200 = 地址失效，需替换或删除）</p>
          <div className="tag-row">
            {verify.map((s: VerifyResult) => (
              <span key={s.url} className={`badge${s.ok && s.items > 0 ? ' badge-green' : ' badge-red'}`}>
                {s.name} {s.ok ? `${s.items} 条` : s.error}
              </span>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="placeholder">
          素材池还是空的。点上方「立即采集」跑一轮；若长期为空，先点「验证源可用性」确认 RSS 地址是否失效。
          <br />
          注意：RSS 只提供最新 20-50 条，无法回溯历史——今天没采的文章，三个月后只能走归档渠道补，成本高一个量级。
        </p>
      ) : (
        <div className="mistake-grid">
          {rows.map((m: MaterialRow) => {
            const fit = fitNum(m.gaokao_fit);
            return (
              <div key={m.id} className="mistake-card">
                <div className="mistake-line" style={{ fontWeight: 600 }}>
                  <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                    {m.title ?? '(无标题)'}
                  </a>
                </div>
                <div className="chip-row" style={{ margin: '8px 0' }}>
                  <span className={`badge${fit !== null && fit >= 7 ? ' badge-green' : ''}`}>
                    适配度 {fit ?? '未打分'}
                  </span>
                  {m.topic && <span className="badge">{m.topic}</span>}
                  {m.genre && <span className="badge">{m.genre}</span>}
                  {m.difficulty && <span className="badge">{m.difficulty}</span>}
                  {m.form && <span className="badge">{m.form}</span>}
                  {m.risk && m.risk !== 'none' && <span className="badge badge-red">{m.risk}</span>}
                  {m.status === 'selected' && (
                    <span className="badge badge-green">已用于 {m.selected_on}</span>
                  )}
                </div>
                {m.summary_zh && <div className="mistake-summary">{m.summary_zh}</div>}
                <div className="mistake-foot">
                  <span>{m.source_name}</span>
                  <span>{m.word_count ? `${m.word_count} 词` : ''}</span>
                  <span>{fmtDate(m.published_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
