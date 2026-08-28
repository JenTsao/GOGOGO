'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

// 菜单2：语义检索中心（探针式搜索）
// 混合检索：关键词 + pgvector 向量语义；层级标签 = 路径中的目录段（Phase 3 做拖拽合并管理）
interface Hit {
  noteId: string;
  filePath: string;
  similarity: number;
  keyword: boolean;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Hit[] | null>(null);
  const [semanticOk, setSemanticOk] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  // 层级标签：取结果路径的目录段（如 数学/微积分）
  const tags = useMemo(() => {
    const set = new Set<string>();
    (results ?? []).forEach((r) => {
      const dirs = r.filePath.split('/').slice(0, -1);
      if (dirs.length > 0) set.add(dirs.join('/'));
    });
    return [...set].sort();
  }, [results]);

  const shown = tag ? (results ?? []).filter((r) => r.filePath.startsWith(`${tag}/`)) : results;

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data.results);
      setSemanticOk(data.semanticOk);
      if (!data.semanticOk) setMessage('⚠️ 向量检索不可用（未配置 Embedding Key），本次为纯关键词结果');
    } catch (e) {
      setMessage(`检索失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const syncVectors = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/knowledge/sync?limit=10', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMessage(`✅ 同步完成：处理 ${data.processed} 篇，向量化 ${data.embeddedFiles} 篇，未变化 ${data.skipped} 篇（每次最多 10 篇，可多次执行）`);
    } catch (e) {
      setMessage(`同步失败：${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">语义检索中心</h1>

      <div className="panel">
        <strong>混合检索框</strong>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="试试：“那种需要设辅助函数的导数题”"
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #ddd',
              fontSize: 15,
            }}
          />
          <button className="btn" onClick={search} disabled={loading}>
            {loading ? '检索中…' : '🔍 检索'}
          </button>
          <button className="btn btn-ghost" onClick={syncVectors} disabled={syncing}>
            {syncing ? '同步中…' : '🔄 同步笔记向量'}
          </button>
        </div>
        {message && <p className="placeholder" style={{ marginTop: 10 }}>{message}</p>}
        {!message && results === null && (
          <p className="placeholder" style={{ marginTop: 10 }}>
            首次使用请先「同步笔记向量」（增量同步，按内容哈希跳过未变化笔记），再检索。
          </p>
        )}
      </div>

      <div className="split">
        <div className="panel" style={{ maxWidth: 320, minWidth: 240 }}>
          <strong>层级标签（来自目录）</strong>
          {tags.length === 0 && <p className="placeholder">检索后显示命中的标签</p>}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tag && (
              <button className="btn btn-ghost" style={{ textAlign: 'left' }} onClick={() => setTag(null)}>
                ✕ 清除筛选
              </button>
            )}
            {tags.map((t) => (
              <button
                key={t}
                className={t === tag ? 'btn' : 'btn btn-ghost'}
                style={{ textAlign: 'left' }}
                onClick={() => setTag(t)}
              >
                #{t}
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <strong>检索结果</strong>
          {shown !== null && shown.length === 0 && <p className="placeholder">没有命中，试试换个说法或先同步向量</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {(shown ?? []).map((r) => (
              <Link
                key={r.noteId}
                href={`/workshop?path=${encodeURIComponent(r.filePath)}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 10,
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>📄 {r.filePath}</span>
                  <span style={{ color: '#888', fontSize: 13 }}>
                    相关度 {(r.similarity * 100).toFixed(0)}%{r.keyword ? ' · 关键词命中' : ''}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          {!semanticOk && results !== null && results.length > 0 && (
            <p className="placeholder" style={{ marginTop: 10 }}>
              当前为纯关键词结果，配置 Embedding Key 后重启可获得语义匹配能力。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
