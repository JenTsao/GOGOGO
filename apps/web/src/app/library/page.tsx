'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

// 知识库阅读区：GitHub 仓库笔记的只读浏览入口（与知识工坊的「编辑」、语义检索的「找」互补）
// 左栏目录树 + 右栏完整 Obsidian 渲染阅读，[[双链]] 库内跳转、大纲锚点、frontmatter 标签展示

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
}

// 扁平路径列表 → 目录树（folders 按字母序、笔记按文件名序）
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

// [[双链]] 目标 → 仓库路径：全路径（含/不含 .md）精确匹配 → 文件名匹配（Obsidian 最短路径原则）
function resolveWikilink(target: string, paths: string[]): string | null {
  const t = target.trim().replace(/#.*$/, '').replace(/^["']|["']$/g, '');
  if (!t) return null;
  const strip = (p: string) => p.replace(/\.md$/, '');
  const exact = paths.find((p) => strip(p) === t);
  if (exact) return exact;
  const base = t.split('/').pop() ?? '';
  return paths.find((p) => p.split('/').pop()?.replace(/\.md$/, '') === base) ?? null;
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

export default function LibraryPage() {
  const [entries, setEntries] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [query, setQuery] = useState('');

  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<NoteData | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const articleRef = useRef<HTMLDivElement>(null);
  const pathsRef = useRef<string[]>([]);

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
        pathsRef.current = paths;
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

  const loadNote = useCallback(async (path: string) => {
    setSelected(path);
    setLoadingNote(true);
    setNoteError(null);
    try {
      const r = await fetch(`/api/library/note?path=${encodeURIComponent(path)}`);
      const data = (await r.json()) as NoteData & { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setNote({ html: data.html, headings: data.headings, tags: data.tags });
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

  const tree = useMemo(() => {
    const q = query.trim().toLowerCase();
    const paths = q ? entries.filter((p) => p.toLowerCase().includes(q)) : entries;
    return buildTree(paths);
  }, [entries, query]);

  const filtering = query.trim().length > 0;
  const folderCount = useMemo(() => new Set(entries.map((p) => p.split('/').slice(0, -1).join('/'))).size, [entries]);

  // 正文事件委托：[[双链]] 点击 → 解析目标路径 → 库内跳转
  const onArticleClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest('.md-wikilink');
    if (!el) return;
    const target = el.getAttribute('data-target') ?? el.textContent ?? '';
    const path = resolveWikilink(target, pathsRef.current);
    if (path) {
      expandAncestors(path);
      loadNote(path);
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
            placeholder="按路径过滤笔记…"
            style={{ width: '100%' }}
          />
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
                  onSelect={(p) => {
                    expandAncestors(p);
                    loadNote(p);
                  }}
                />
              ))}
              {!loadingTree && tree.length === 0 && <div className="placeholder">没有匹配的笔记</div>}
            </div>
          )}
        </div>

        <div className="panel lib-reader">
          {!selected && (
            <div className="placeholder">
              从左栏选择一篇笔记开始阅读。支持完整的 Obsidian 语法渲染：callout、公式、高亮、任务列表、双链跳转。
            </div>
          )}
          {selected && (
            <>
              <div className="lib-head">
                <div>
                  <div className="lib-title">{selected.split('/').pop()?.replace(/\.md$/, '')}</div>
                  <div className="muted-line">{selected}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {note?.tags.map((t) => (
                    <span key={t} className="lib-tag">#{t}</span>
                  ))}
                  <Link className="btn-ghost btn" href="/workshop">✍️ 去工坊编辑</Link>
                </div>
              </div>

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
            </>
          )}
        </div>
      </div>
    </>
  );
}
