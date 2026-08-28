'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

// 菜单2：语义检索中心（探针式搜索）
// 混合检索：关键词 + pgvector 向量语义
// 左栏层级标签树：数据源 obsidian_metadata.tags（sync 时从 #行内标签/frontmatter 提取），
// 支持重命名 / 合并 / 删除（子层级跟随）与检索结果批量关联标签
interface Hit {
  noteId: string;
  filePath: string;
  similarity: number;
  keyword: boolean;
}

interface TagNode {
  name: string;
  path: string;
  count: number;
  children: TagNode[];
}

// 递归标签树节点：外置组件，保证展开态在父级重渲染时不丢失
function TagItem({
  node,
  depth,
  active,
  busy,
  onSelect,
  onAction,
}: {
  node: TagNode;
  depth: number;
  active: boolean;
  busy: boolean;
  onSelect: (node: TagNode) => void;
  onAction: (action: 'rename' | 'merge' | 'delete', node: TagNode) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 4px',
          paddingLeft: 4 + depth * 14,
          borderRadius: 6,
          background: active ? '#eef2ff' : undefined,
          cursor: 'pointer',
        }}
        onClick={() => onSelect(node)}
        title={`${node.path}（${node.count} 篇）`}
      >
        {node.children.length > 0 ? (
          <span onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>{open ? '▾' : '▸'}</span>
        ) : (
          <span style={{ width: 10 }} />
        )}
        <span style={{ flex: 1, fontWeight: active ? 700 : 400, fontSize: 14 }}>
          #{node.name} <span style={{ color: '#999', fontSize: 12 }}>{node.count}</span>
        </span>
        <span style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost" style={{ padding: '0 6px', fontSize: 12 }} title="重命名（子层级跟随）" disabled={busy} onClick={() => onAction('rename', node)}>✏️</button>
          <button className="btn btn-ghost" style={{ padding: '0 6px', fontSize: 12 }} title="合并到其他标签（子层级跟随）" disabled={busy} onClick={() => onAction('merge', node)}>🔀</button>
          <button className="btn btn-ghost" style={{ padding: '0 6px', fontSize: 12 }} title="删除（含子层级）" disabled={busy} onClick={() => onAction('delete', node)}>🗑</button>
        </span>
      </div>
      {open &&
        node.children.map((c) => (
          <TagItem
            key={c.path}
            node={c}
            depth={depth + 1}
            active={active}
            busy={busy}
            onSelect={onSelect}
            onAction={onAction}
          />
        ))}
    </div>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Hit[] | null>(null);
  const [semanticOk, setSemanticOk] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagTree, setTagTree] = useState<TagNode[] | null>(null);
  const [byPath, setByPath] = useState<Record<string, string[]>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [assignTag, setAssignTag] = useState('');
  const [tagBusy, setTagBusy] = useState(false);

  const loadTags = async () => {
    try {
      const r = await fetch('/api/tags');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setTagTree(data.tree as TagNode[]);
      setByPath((data.byPath as Record<string, string[]>) ?? {});
    } catch {
      // 标签树加载失败静默：检索功能不受影响
    }
  };
  useEffect(() => {
    void loadTags();
  }, []);

  // 标签筛选：笔记任一标签 === 选中路径 或 以其前缀开头（选中「数学」时含「数学/微积分」的笔记也命中）
  const shown = useMemo(() => {
    if (!tagFilter) return results;
    return (results ?? []).filter((r) =>
      (byPath[r.filePath] ?? []).some((t) => t === tagFilter || t.startsWith(`${tagFilter}/`))
    );
  }, [results, tagFilter, byPath]);

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
      await loadTags();
    } catch (e) {
      setMessage(`同步失败：${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  // 标签操作：rename / merge / delete（子层级跟随）
  const tagAction = async (action: 'rename' | 'merge' | 'delete', node: TagNode) => {
    const to =
      action === 'delete'
        ? undefined
        : window.prompt(action === 'rename' ? `重命名「${node.path}」为：` : `把「${node.path}」合并到（含子层级）：`, node.path);
    if (action !== 'delete' && !to) return;
    setTagBusy(true);
    setMessage(null);
    try {
      const r = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, from: node.path, to }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setMessage(`✅ 已更新 ${data.changed} 篇笔记的标签`);
      if (tagFilter && (tagFilter === node.path || tagFilter.startsWith(`${node.path}/`))) setTagFilter(null);
      await loadTags();
    } catch (e) {
      setMessage(`标签操作失败：${(e as Error).message}`);
    } finally {
      setTagBusy(false);
    }
  };

  // 批量关联：给勾选的笔记追加标签
  const assign = async () => {
    const tag = assignTag.trim().replace(/^#/, '');
    if (!tag || checked.size === 0) return;
    setTagBusy(true);
    setMessage(null);
    try {
      const r = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', to: tag, paths: [...checked] }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setMessage(`✅ 已为 ${data.changed} 篇笔记添加 #${tag}（未同步过的笔记会跳过）`);
      setChecked(new Set());
      setAssignTag('');
      await loadTags();
    } catch (e) {
      setMessage(`批量关联失败：${(e as Error).message}`);
    } finally {
      setTagBusy(false);
    }
  };

  // 递归树节点（组件外置定义，见下方 TagItem）
  const renderTag = (node: TagNode, depth: number) => (
    <TagItem
      key={node.path}
      node={node}
      depth={depth}
      active={tagFilter === node.path}
      busy={tagBusy}
      onSelect={() => setTagFilter(tagFilter === node.path ? null : node.path)}
      onAction={(a) => void tagAction(a, node)}
    />
  );

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
        <div className="panel" style={{ maxWidth: 340, minWidth: 260 }}>
          <strong>层级标签树</strong>
          <p className="placeholder" style={{ margin: '4px 0 8px' }}>
            来自笔记 #行内标签 与 frontmatter（同步时提取）。点击筛选；✏️ 重命名 / 🔀 合并 / 🗑 删除，子层级自动跟随。
          </p>
          {tagTree !== null && tagTree.length === 0 && (
            <p className="placeholder">暂无标签：笔记里写 #数学/微积分/导数 或 frontmatter tags 后重新同步。</p>
          )}
          {tagFilter && (
            <button className="btn btn-ghost" style={{ marginBottom: 6 }} onClick={() => setTagFilter(null)}>
              ✕ 清除筛选：{tagFilter}
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(tagTree ?? []).map((n) => renderTag(n, 0))}
          </div>
        </div>

        <div className="panel">
          <strong>检索结果（勾选后可批量关联标签）</strong>
          {shown !== null && shown.length === 0 && <p className="placeholder">没有命中，试试换个说法或先同步向量</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {(shown ?? []).map((r) => (
              <div
                key={r.noteId}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 10,
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked.has(r.filePath)}
                  onChange={(e) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(r.filePath);
                      else next.delete(r.filePath);
                      return next;
                    })
                  }
                />
                <Link href={`/workshop?path=${encodeURIComponent(r.filePath)}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
                  📄 {r.filePath}
                  <div style={{ color: '#999', fontSize: 12 }}>
                    相关度 {(r.similarity * 100).toFixed(0)}%{r.keyword ? ' · 关键词命中' : ''}
                    {(byPath[r.filePath] ?? []).length > 0 && ` · ${byPath[r.filePath].map((t) => `#${t}`).join(' ')}`}
                  </div>
                </Link>
              </div>
            ))}
          </div>

          {checked.size > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input
                value={assignTag}
                onChange={(e) => setAssignTag(e.target.value)}
                placeholder="标签名（可含层级：数学/易错）"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
              />
              <button className="btn btn-primary" onClick={assign} disabled={tagBusy}>
                {tagBusy ? '处理中…' : `➕ 给 ${checked.size} 篇添加标签`}
              </button>
            </div>
          )}

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
