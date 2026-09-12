'use client';

import Link from 'next/link';
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent, type MouseEvent,
} from 'react';
import LibraryGraph, { type GraphNode } from './LibraryGraph';

// 知识库阅读区：GitHub 仓库笔记的只读浏览入口（与知识工坊的「编辑」、语义检索的「找」互补）
// 对标 Obsidian 核心：目录树 / 双链跳转（含别名）/ 反链·出链面板 / 未解析链接标注 /
// 关系图谱 / Ctrl+K 快速切换器 / 书签与最近阅读 / 大纲 / 字数与阅读时长

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
}

interface TreeNode {
  name: string;
  path: string;
  folder: boolean;
  children: TreeNode[];
}

interface Heading {
  level: number;
  text: string;
  id: string;
}

interface NoteData {
  html: string;
  headings: Heading[];
  tags: string[];
  aliases: string[];
  wordCount: number;
  readMinutes: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: [string, string][];
  unresolved: Record<string, number>;
  unresolvedBy: Record<string, string[]>;
}

// 双链解析索引：全路径 → 文件名 → 别名 三级匹配（与图谱 API 服务端规则一致）
// 全部映射到「完整仓库路径（含 .md）」——双链跳转要拿完整路径请求 raw，缺扩展名会 404
interface LinkIndex {
  byPath: Map<string, string>;
  byBase: Map<string, string>;
  byAlias: Map<string, string>;
}

const STARS_KEY = 'gk-lib-stars';
const RECENT_KEY = 'gk-lib-recent';

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // 隐私模式等存储不可用：静默降级为会话级
  }
}

function buildIndex(entries: string[], graph: GraphData | null): LinkIndex {
  const idx: LinkIndex = {
    byPath: new Map(),
    byBase: new Map(),
    byAlias: new Map(),
  };
  for (const p of entries) {
    const stripped = p.replace(/\.md$/, '');
    if (!idx.byPath.has(stripped)) idx.byPath.set(stripped, p);
    const base = p.split('/').pop()?.replace(/\.md$/, '') ?? '';
    if (base && !idx.byBase.has(base)) idx.byBase.set(base, p);
  }
  if (graph) {
    for (const n of graph.nodes) {
      for (const a of n.aliases) if (!idx.byAlias.has(a)) idx.byAlias.set(a, n.path);
    }
  }
  return idx;
}

// [[目标]] → 完整仓库路径（含 .md）：全路径（含/不含 .md）→ 文件名（Obsidian 最短路径）→ 别名
function resolveLink(target: string, idx: LinkIndex): string | null {
  const t = target.trim().replace(/#.*$/, '').replace(/\^[\w-]+$/, '').replace(/^["']|["']$/g, '');
  if (!t) return null;
  const stripped = t.replace(/\.md$/, '');
  return idx.byPath.get(stripped) ?? idx.byPath.get(t) ?? idx.byBase.get(stripped) ?? idx.byAlias.get(stripped) ?? idx.byAlias.get(t) ?? null;
}

// 扁平路径列表 → 目录树（目录在前、各自按中文字序）
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', folder: true, children: [] };
  for (const p of paths) {
    const segs = p.split('/');
    let cur = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      let next = cur.children.find((c) => c.folder && c.name === seg);
      if (!next) {
        next = { name: seg, path: segs.slice(0, i + 1).join('/'), folder: true, children: [] };
        cur.children.push(next);
      }
      cur = next;
    }
    cur.children.push({ name: segs[segs.length - 1], path: p, folder: false, children: [] });
  }
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) =>
      a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hans-CN')
    );
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function TreeRow({
  node,
  depth,
  expanded,
  selected,
  forceOpen,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  forceOpen: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const open = forceOpen || expanded.has(node.path);
  return (
    <div>
      <div
        className={`lib-row${!node.folder && selected === node.path ? ' lib-row-active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.path}
        onClick={() => (node.folder ? onToggle(node.path) : onSelect(node.path))}
      >
        {node.folder ? (
          <span className="lib-caret" onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}>
            {open ? '▾' : '▸'}
          </span>
        ) : (
          <span className="lib-caret">📄</span>
        )}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.folder ? `📁 ${node.name}` : node.name.replace(/\.md$/, '')}
        </span>
      </div>
      {open &&
        node.children.map((c) => (
          <TreeRow
            key={c.path}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            forceOpen={forceOpen}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// Ctrl+K 快速切换器（对标 Obsidian Quick Switcher）：子序列模糊匹配，键盘全操作
function QuickSwitcher({
  open,
  paths,
  onClose,
  onPick,
}: {
  open: boolean;
  paths: string[];
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return paths.slice(0, 40);
    const scored: { p: string; s: number }[] = [];
    for (const p of paths) {
      const lp = p.toLowerCase();
      const base = (p.split('/').pop() ?? '').toLowerCase();
      const at = lp.indexOf(query);
      if (at >= 0) {
        // 子串命中：文件名命中权重最高，越靠前越好
        const bt = base.indexOf(query);
        scored.push({ p, s: bt >= 0 ? 1000 - bt * 10 : 500 - at });
        continue;
      }
      // 子序列匹配（快速打字容错）
      let i = 0;
      for (const ch of query) {
        i = lp.indexOf(ch, i);
        if (i < 0) break;
        i++;
      }
      if (i >= 0 && query.length > 1) scored.push({ p, s: 100 + query.length });
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.p);
  }, [q, paths]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
    }
  }, [open]);

  useEffect(() => {
    setSel(0);
  }, [q]);

  useEffect(() => {
    listRef.current?.querySelector('.lib-sw-active')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
    else if (e.key === 'Enter' && results[sel]) { onPick(results[sel]); onClose(); }
    else if (e.key === 'Escape') onClose();
  };
  return (
    <div className="lib-sw-mask" onClick={onClose}>
      <div className="lib-sw" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入笔记名或路径，↑↓ 选择，Enter 打开，Esc 关闭"
        />
        <div className="lib-sw-list" ref={listRef}>
          {results.map((p, i) => (
            <div
              key={p}
              className={`lib-sw-item${i === sel ? ' lib-sw-active' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => { onPick(p); onClose(); }}
            >
              <span className="lib-sw-name">{p.split('/').pop()?.replace(/\.md$/, '')}</span>
              <span className="lib-sw-path">{p}</span>
            </div>
          ))}
          {results.length === 0 && <div className="placeholder" style={{ padding: 14 }}>没有匹配的笔记</div>}
        </div>
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const [entries, setEntries] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [query, setQuery] = useState('');
  const [starOnly, setStarOnly] = useState(false);
  const [stars, setStars] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);

  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<NoteData | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  const [graph, setGraph] = useState<GraphData | null>(null);
  const [view, setView] = useState<'read' | 'graph'>('read');
  const [switcher, setSwitcher] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const articleRef = useRef<HTMLDivElement>(null);

  // 书签 / 最近阅读：localStorage 持久化
  useEffect(() => {
    setStars(readList(STARS_KEY));
    setRecent(readList(RECENT_KEY));
  }, []);

  // 拉取仓库文件树（token 仅服务端，客户端只拿 md 路径清单）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/github/tree');
        const data = (await r.json()) as { entries?: TreeEntry[]; truncated?: boolean; error?: string };
        if (!alive) return;
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        const paths = (data.entries ?? []).map((e) => e.path);
        setEntries(paths);
        setTruncated(data.truncated === true);
        // 默认展开第一层目录，首屏不至全折叠
        setExpanded(new Set(paths.filter((p) => p.includes('/')).map((p) => p.split('/')[0])));
      } catch (e) {
        if (alive) setLoadError((e as Error).message);
      } finally {
        if (alive) setLoadingTree(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 图谱索引：懒加载（服务端 10 分钟缓存，冷启动需全库扫描，加载完成前相关功能优雅降级）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/library/graph');
        const data = (await r.json()) as GraphData & { error?: string };
        if (!alive) return;
        if (r.ok) setGraph({
          nodes: data.nodes,
          edges: data.edges,
          unresolved: data.unresolved ?? {},
          unresolvedBy: data.unresolvedBy ?? {},
        });
      } catch {
        // 图谱加载失败不影响阅读主流程
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const idx = useMemo(() => buildIndex(entries, graph), [entries, graph]);

  // 反向链接：图谱里指向当前笔记的边
  const backlinks = useMemo(
    () => (selected && graph ? graph.edges.filter(([, t]) => t === selected).map(([s]) => s) : []),
    [selected, graph]
  );
  // 出链：图谱里从当前笔记出发的边（去重）+ 本篇未解析的双链（❓ 标注，不可跳转）
  const outlinks = useMemo(
    () => (selected && graph ? [...new Set(graph.edges.filter(([s]) => s === selected).map(([, t]) => t))] : []),
    [selected, graph]
  );
  const missingOut = useMemo(
    () => (selected && graph ? graph.unresolvedBy?.[selected] ?? [] : []),
    [selected, graph]
  );

  const loadNote = useCallback(async (path: string) => {
    setSelected(path);
    setLoadingNote(true);
    setNoteError(null);
    try {
      const r = await fetch(`/api/library/note?path=${encodeURIComponent(path)}`);
      const data = (await r.json()) as NoteData & { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setNote({
        html: data.html,
        headings: data.headings,
        tags: data.tags,
        aliases: data.aliases ?? [],
        wordCount: data.wordCount ?? 0,
        readMinutes: data.readMinutes ?? 1,
      });
      // 最近阅读（去重置顶，上限 20）
      setRecent((prev) => {
        const next = [path, ...prev.filter((p) => p !== path)].slice(0, 20);
        writeList(RECENT_KEY, next);
        return next;
      });
      // 切换笔记后回到顶部，避免上一篇的滚动位置串到新笔记
      requestAnimationFrame(() => articleRef.current?.scrollTo({ top: 0 }));
    } catch (e) {
      setNote(null);
      setNoteError((e as Error).message);
    } finally {
      setLoadingNote(false);
    }
  }, []);

  // 打开笔记时展开其祖先目录，保证树上有落点
  const expandAncestors = useCallback((path: string) => {
    const segs = path.split('/');
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i < segs.length; i++) next.add(segs.slice(0, i).join('/'));
      return next;
    });
  }, []);

  const openNote = useCallback((path: string) => {
    expandAncestors(path);
    setView('read');
    loadNote(path);
  }, [expandAncestors, loadNote]);

  // Ctrl+K / Cmd+K 全局快捷键
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSwitcher((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleStar = (path: string) => {
    setStars((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [path, ...prev];
      writeList(STARS_KEY, next);
      return next;
    });
  };

  const tree = useMemo(() => {
    const q = query.trim().toLowerCase();
    let paths = q ? entries.filter((p) => p.toLowerCase().includes(q)) : entries;
    if (starOnly) paths = paths.filter((p) => stars.includes(p));
    return buildTree(paths);
  }, [entries, query, starOnly, stars]);

  const filtering = query.trim().length > 0 || starOnly;
  const folderCount = useMemo(() => new Set(entries.map((p) => p.split('/').slice(0, -1).join('/'))).size, [entries]);
  const unresolvedTargets = useMemo(
    () => (graph ? Object.entries(graph.unresolved).sort((a, b) => b[1] - a[1]).slice(0, 15) : []),
    [graph]
  );

  // 断链标注：渲染完成后给解析不到的 .md-wikilink 挂灰色样式
  useEffect(() => {
    if (!note || !articleRef.current) return;
    const raf = requestAnimationFrame(() => {
      articleRef.current?.querySelectorAll<HTMLElement>('.md-wikilink').forEach((el) => {
        const t = el.getAttribute('data-target') ?? el.textContent ?? '';
        if (!resolveLink(t, idx)) el.classList.add('md-wikilink-missing');
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [note, idx]);

  // 正文事件委托：[[双链]] 点击 → 解析目标路径 → 库内跳转
  const onArticleClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest('.md-wikilink');
    if (!el) return;
    const target = el.getAttribute('data-target') ?? el.textContent ?? '';
    const path = resolveLink(target, idx);
    if (path) {
      openNote(path);
    } else {
      setNoteError(`双链「${target}」未匹配到库内笔记`);
    }
  };

  const jumpToHeading = (id: string) => {
    articleRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <h1 className="page-title">📚 知识库</h1>

      <div className="split library-split">
        <div className="panel lib-side">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按路径过滤笔记…（Ctrl+K 全库快搜）"
            style={{ width: '100%' }}
          />
          <div className="lib-side-tools">
            <button
              type="button"
              className={`chip${starOnly ? ' chip-active' : ''}`}
              onClick={() => setStarOnly((v) => !v)}
            >
              ⭐ 只看书签（{stars.length}）
            </button>
            <button type="button" className="chip" onClick={() => setSwitcher(true)}>⚡ 快速切换</button>
          </div>
          <div className="muted-line">
            {loadingTree ? '目录树加载中…' : `共 ${entries.length} 篇笔记 · ${folderCount} 个目录`}
            {truncated ? '（⚠️ 目录树被 GitHub 截断，仅显示部分）' : ''}
          </div>
          {loadError ? (
            <div className="placeholder">❌ {loadError}</div>
          ) : (
            <div className="lib-tree">
              {tree.map((n) => (
                <TreeRow
                  key={n.path}
                  node={n}
                  depth={0}
                  expanded={expanded}
                  selected={selected}
                  forceOpen={filtering}
                  onToggle={(p) =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(p)) next.delete(p);
                      else next.add(p);
                      return next;
                    })
                  }
                  onSelect={openNote}
                />
              ))}
              {!loadingTree && tree.length === 0 && <div className="placeholder">没有匹配的笔记</div>}
            </div>
          )}
          {unresolvedTargets.length > 0 && (
            <details className="lib-missing-box">
              <summary>❓ 未解析双链（{Object.keys(graph?.unresolved ?? {}).length}）</summary>
              {unresolvedTargets.map(([t, n]) => (
                <div key={t} className="muted-line">[[{t}]] × {n}</div>
              ))}
            </details>
          )}
        </div>

        <div className="panel lib-reader">
          {!selected && (
            <div className="placeholder">
              <p>从左栏选择一篇笔记开始阅读，或按 <b>Ctrl+K</b> 全库快搜。</p>
              <p>支持 Obsidian 核心体验：双链跳转（含别名）、反链/出链、关系图谱、大纲、callout、公式。</p>
              {recent.length > 0 && (
                <>
                  <p style={{ marginTop: 18, fontWeight: 700 }}>🕘 最近阅读</p>
                  {recent.map((p) => (
                    <div key={p} className="lib-link-row" onClick={() => openNote(p)}>
                      {p.split('/').pop()?.replace(/\.md$/, '')}
                      <span className="lib-sw-path"> · {p}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {selected && (
            <>
              <div className="lib-head">
                <div>
                  <div className="lib-title">{selected.split('/').pop()?.replace(/\.md$/, '')}</div>
                  <div className="muted-line">
                    {selected}
                    {note ? ` · 约 ${note.wordCount} 字 · 预计 ${note.readMinutes} 分钟` : ''}
                    {note && note.aliases.length > 0 ? ` · 别名：${note.aliases.join(' / ')}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`chip${stars.includes(selected) ? ' chip-active' : ''}`}
                    onClick={() => toggleStar(selected)}
                    title="收藏到书签"
                  >
                    {stars.includes(selected) ? '⭐ 已收藏' : '☆ 收藏'}
                  </button>
                  <button
                    type="button"
                    className={`chip${view === 'graph' ? ' chip-active' : ''}`}
                    onClick={() => setView((v) => (v === 'graph' ? 'read' : 'graph'))}
                    title="本篇在关系图谱中的位置"
                  >
                    🕸 图谱
                  </button>
                  {note?.tags.map((t) => (
                    <span key={t} className="lib-tag">#{t}</span>
                  ))}
                  <Link className="btn-ghost btn" href="/workshop">✍️ 去工坊编辑</Link>
                </div>
              </div>

              {view === 'graph' ? (
                graph ? (
                  <div className="lib-graph-wrap">
                    <LibraryGraph
                      nodes={graph.nodes}
                      edges={graph.edges}
                      selected={selected}
                      onSelect={openNote}
                    />
                  </div>
                ) : (
                  <div className="placeholder">🕸 关系图谱索引构建中（首次需扫描全库笔记，稍后自动可用）…</div>
                )
              ) : (
                <>
                  {note && note.headings.length >= 3 && (
                    <details className="lib-toc">
                      <summary>大纲（{note.headings.length}）</summary>
                      <div>
                        {note.headings.map((h) => (
                          <div
                            key={h.id}
                            className="lib-toc-item"
                            style={{ paddingLeft: 4 + (h.level - 1) * 14 }}
                            onClick={() => jumpToHeading(h.id)}
                          >
                            {h.text}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {loadingNote && <div className="placeholder">渲染中…</div>}
                  {noteError && <div className="placeholder">❌ {noteError}</div>}
                  {note && !loadingNote && (
                    <div
                      ref={articleRef}
                      className="lib-md lib-article"
                      onClick={onArticleClick}
                      dangerouslySetInnerHTML={{ __html: note.html }}
                    />
                  )}

                  {/* 反链 / 出链面板（Obsidian 反向链接面板对标） */}
                  {graph && (
                    <div className="lib-links">
                      <div className="lib-links-col">
                        <div className="lib-links-title">🔗 反向链接（{backlinks.length}）</div>
                        {backlinks.slice(0, 30).map((p) => (
                          <div key={p} className="lib-link-row" onClick={() => openNote(p)}>
                            {p.split('/').pop()?.replace(/\.md$/, '')}
                            <span className="lib-sw-path"> · {p}</span>
                          </div>
                        ))}
                        {backlinks.length === 0 && <div className="muted-line">暂无笔记链接到本篇</div>}
                        {backlinks.length > 30 && <div className="muted-line">…还有 {backlinks.length - 30} 篇</div>}
                      </div>
                      <div className="lib-links-col">
                        <div className="lib-links-title">↗ 出链（{outlinks.length}{missingOut.length > 0 ? ` · ❓ ${missingOut.length} 未解析` : ''}）</div>
                        {outlinks.slice(0, 30).map((p) => (
                          <div key={p} className="lib-link-row" onClick={() => openNote(p)}>
                            {p.split('/').pop()?.replace(/\.md$/, '')}
                            <span className="lib-sw-path"> · {p}</span>
                          </div>
                        ))}
                        {missingOut.map((t) => (
                          <div key={t} className="lib-link-row lib-link-missing" title="未解析：库内没有匹配的笔记">
                            ❓ {t}
                          </div>
                        ))}
                        {outlinks.length === 0 && missingOut.length === 0 && <div className="muted-line">本篇暂无双链出链</div>}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <QuickSwitcher open={switcher} paths={entries} onClose={() => setSwitcher(false)} onPick={openNote} />
    </>
  );
}
