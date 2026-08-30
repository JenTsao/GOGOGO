'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react';
import { useWebTheme } from '@/lib/webTheme';

// 菜单1：知识工坊（可编辑保存 + AI 精炼/图谱 + 版本回滚 + 拖拽传图 WebP）
interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
}

// 把扁平路径列表构建为目录树
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let cur = root;
    parts.forEach((name, i) => {
      const isLeaf = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === name && !!c.children.length === !isLeaf);
      if (!next) {
        next = { name, path: parts.slice(0, i + 1).join('/'), children: isLeaf ? [] : [] };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => b.children.length - a.children.length || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

// 递归文件树节点：打开文件与勾选（供 AI 精炼）分离
function TreeItem({
  node,
  depth,
  selected,
  checked,
  onOpen,
  onCheck,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  checked: Set<string>;
  onOpen: (path: string) => void;
  onCheck: (path: string, v: boolean) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isFolder = node.children.length > 0;
  if (isFolder) {
    return (
      <div>
        <div
          className="tree-row"
          style={{ paddingLeft: 8 + depth * 14, cursor: 'pointer', fontWeight: 600 }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '▾' : '▸'} {node.name}
        </div>
        {open &&
          node.children.map((c) => (
            <TreeItem
              key={c.path}
              node={c}
              depth={depth + 1}
              selected={selected}
              checked={checked}
              onOpen={onOpen}
              onCheck={onCheck}
            />
          ))}
      </div>
    );
  }
  return (
    <div
      className="tree-row"
      style={{
        paddingLeft: 8 + depth * 14,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        color: selected === node.path ? 'var(--text)' : 'var(--text2)',
        fontWeight: selected === node.path ? 700 : 400,
        background: selected === node.path ? 'var(--primary-soft)' : undefined,
        borderRadius: 6,
      }}
    >
      <input
        type="checkbox"
        checked={checked.has(node.path)}
        onChange={(e) => onCheck(node.path, e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        title="勾选后可用 AI 精炼工具栏"
      />
      <span style={{ flex: 1 }} onClick={() => onOpen(node.path)}>
        📄 {node.name}
      </span>
    </div>
  );
}

// Mermaid 关系图渲染：动态引入避免阻塞首屏；主题跟随页面深浅色
function MermaidView({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const scheme = useWebTheme();
  useEffect(() => {
    let alive = true;
    import('mermaid')
      .then((mod) => {
        const mermaid = mod.default;
        // neutral 浅色系 / dark 深色系：颜色跟随当前主题，保证深色下节点文字可读
        mermaid.initialize({ startOnLoad: false, theme: scheme === 'dark' ? 'dark' : 'neutral' });
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        return mermaid.render(id, code) as Promise<{ svg: string }>;
      })
      .then(({ svg }) => {
        if (alive) setSvg(svg);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [code, scheme]);
  if (error)
    return (
      <pre className="refine-code">{`Mermaid 渲染失败：${error}\n\n${code}`}</pre>
    );
  // eslint-disable-next-line react/no-danger -- mermaid.render 输出的可信 SVG（本地渲染，无用户脚本注入面）
  return svg ? <div className="mermaid-view" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="placeholder">渲染图中…</p>;
}

// 客户端图片压缩：最长边 1280，输出 WebP（蓝皮书「拖拽传图自动压缩 WebP」）
async function compressToWebp(file: File): Promise<{ base64: string; filename: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
  if (!blob) throw new Error('WebP 编码失败');
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), filename: 'img.webp' };
}

export default function WorkshopPage() {
  // useSearchParams 需要 Suspense 边界（Next.js CSR bailout 约束）
  return (
    <Suspense fallback={<h1 className="page-title">知识工坊</h1>}>
      <WorkshopInner />
    </Suspense>
  );
}

function WorkshopInner() {
  const searchParams = useSearchParams();
  const scheme = useWebTheme();
  const [paths, setPaths] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [refining, setRefining] = useState<'merge' | 'graph' | null>(null);
  const [refineText, setRefineText] = useState<string | null>(null);
  const [refineMode, setRefineMode] = useState<'merge' | 'graph'>('merge');
  const [versions, setVersions] = useState<{ ts: string; size: number; content: string }[] | null>(null);
  const [uploading, setUploading] = useState(false);

  // Monaco 实例引用：Ctrl+S 保存与拖拽插入需要编辑器 API
  const editorRef = useRef<Monaco['editor']['IStandaloneCodeEditor'] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const tree = useMemo(() => (paths ? buildTree(paths) : []), [paths]);

  useEffect(() => {
    fetch('/api/github/tree')
      .then(async (r) => {
        // 必须先判 r.ok：非 2xx 时 Vercel/网关返回的是 HTML，直接 json() 会抛出「Unexpected token '<'」掩盖真实原因
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { entries?: { path: string }[] };
        setPaths((data.entries ?? []).map((e) => e.path));
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const openFile = useCallback(async (path: string) => {
    setSelected(path);
    setLoading(true);
    setDirty(false);
    setSaveMsg(null);
    setVersions(null);
    try {
      const r = await fetch(`/api/github/raw?path=${encodeURIComponent(path)}`);
      const text = await r.text();
      setContent(r.ok ? text : `读取失败：${text}`);
    } catch (e) {
      setContent(`读取失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 支持从语义检索中心带 ?path= 直达某篇笔记
  const pathParam = searchParams.get('path');
  useEffect(() => {
    if (pathParam) openFile(pathParam);
  }, [pathParam, openFile]);

  // 保存到 GitHub（并记录版本快照）
  const save = useCallback(async () => {
    const path = selected;
    if (!path) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await fetch('/api/github/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: contentRef.current }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setDirty(false);
      setSaveMsg(data.versionTs ? `✅ 已提交 GitHub 并记录版本快照` : '✅ 已提交 GitHub（版本快照未记录：未配置 OWNER_USER_ID）');
    } catch (e) {
      setSaveMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [selected]);

  // Ctrl/Cmd+S 快捷保存：
  // onMount 只触发一次（编辑器首渲染即挂载，那时 selected 还是 null），
  // 若直接闭包捕获 save，命令里永远是 selected=null 的旧版本，按 Ctrl+S 静默无反应。
  // 用 ref 每次渲染同步最新闭包。
  const saveRef = useRef(save);
  saveRef.current = save;
  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current();
    });
  };

  // AI 精炼 / 知识图谱
  const runRefine = useCallback(
    async (mode: 'merge' | 'graph') => {
      if (checked.size === 0) {
        setRefineText('请先在文件树勾选笔记（可多篇）。');
        setRefineMode(mode);
        return;
      }
      setRefining(mode);
      setRefineMode(mode);
      setRefineText(null);
      try {
        const r = await fetch('/api/workshop/refine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: [...checked], mode }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        setRefineText(data.text as string);
      } catch (e) {
        setRefineText(`精炼失败：${(e as Error).message}`);
      } finally {
        setRefining(null);
      }
    },
    [checked]
  );

  // 版本历史：加载列表
  const loadVersions = useCallback(async () => {
    if (!selected) return;
    setVersions(null);
    try {
      const r = await fetch(`/api/github/versions?path=${encodeURIComponent(selected)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setVersions(data.entries ?? []);
    } catch (e) {
      setSaveMsg(`❌ 版本历史读取失败：${(e as Error).message}`);
    }
  }, [selected]);

  // 一键回滚：把快照内容填回编辑器（需再点保存才提交）
  const rollback = useCallback(
    (ts: string, text: string) => {
      setContent(text);
      setDirty(true);
      setSaveMsg(`⏪ 已回滚到 ${ts} 的快照（确认后点击保存提交）`);
    },
    []
  );

  // 拖拽图片 → 压缩 WebP → 上传 → 光标处插入 Markdown
  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      // preventDefault 必须无条件先执行：放在提前 return 之后，拖入非图片文件时浏览器会
      // 用该文件替换当前页，编辑器里未保存的内容直接丢失
      e.preventDefault();
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
      if (!file || !selected) return;
      setUploading(true);
      setSaveMsg(null);
      try {
        const { base64, filename } = await compressToWebp(file);
        const r = await fetch('/api/github/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, base64 }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        const ed = editorRef.current;
        const snippet = `\n![${filename}](${data.url})\n`;
        if (ed && monacoRef.current) {
          const pos = ed.getPosition();
          if (pos) {
            ed.executeEdits('upload', [
              { range: new monacoRef.current.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: snippet },
            ]);
          }
        }
        setDirty(true);
        setSaveMsg(`✅ 图片已上传：${data.url}`);
      } catch (err) {
        setSaveMsg(`❌ 图片上传失败：${(err as Error).message}`);
      } finally {
        setUploading(false);
      }
    },
    [selected]
  );

  const onCheck = useCallback((path: string, v: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (v) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  return (
    <div>
      <h1 className="page-title">知识工坊</h1>
      <div className="split workshop-split">
        <div className="panel">
          <strong>GitHub 文件树（勾选供 AI 精炼 · 共 {checked.size} 篇）</strong>
          {error && <p className="placeholder">⚠️ {error}</p>}
          {!error && paths === null && <p className="placeholder">加载目录树中…</p>}
          {paths !== null && paths.length === 0 && (
            <p className="placeholder">目录树为空。请在 .env.local 配置 GITHUB_REPO=owner/repo（Obsidian 仓库）。</p>
          )}
          <div className="tree">
            {tree.map((n) => (
              <TreeItem
                key={n.path}
                node={n}
                depth={0}
                selected={selected}
                checked={checked}
                onOpen={openFile}
                onCheck={onCheck}
              />
            ))}
          </div>
        </div>
        <div className="panel" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ flex: 1 }}>
              {selected ? (dirty ? `正在编辑：${selected} *` : `当前：${selected}`) : '点击左侧文件开始编辑'}
              {loading && ' · 加载中…'}
              {uploading && ' · 图片上传中…'}
            </strong>
            <button className="btn" onClick={() => void loadVersions()} disabled={!selected}>
              🕘 版本历史
            </button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={!selected || !dirty || saving}>
              {saving ? '保存中…' : '💾 保存到 GitHub'}
            </button>
          </div>
          {saveMsg && <p className="placeholder" style={{ margin: '6px 0' }}>{saveMsg}</p>}
          <div className="editor-wrap">
            <Editor
              language="markdown"
              theme={scheme === 'dark' ? 'vs-dark' : 'vs'}
              value={content}
              onChange={(v) => {
                setContent(v ?? '');
                setDirty(true);
              }}
              onMount={onMount}
              options={{
                minimap: { enabled: false },
                wordWrap: 'on',
                fontSize: 14,
                lineNumbers: 'off',
              }}
            />
          </div>
          <p className="placeholder" style={{ marginTop: 6 }}>
            支持拖拽图片进编辑器（自动压缩为 WebP 上传并插入链接）；Ctrl/Cmd+S 快捷保存；版本历史可一键回滚。
          </p>

          {versions !== null && (
            <div className="versions-panel">
              <strong>🕘 版本快照（{versions.length} 条，最新在前）</strong>
              {versions.length === 0 && <p className="placeholder">暂无快照：保存一次后生成。</p>}
              {versions.map((v) => (
                <div key={v.ts} className="version-row">
                  <span style={{ flex: 1 }}>
                    {new Date(v.ts).toLocaleString('zh-CN')} · {v.size} 字
                  </span>
                  <button className="btn" onClick={() => rollback(v.ts, v.content)}>
                    ⏪ 回滚到此版本
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <strong>AI 精炼工具栏（已勾选 {checked.size} 篇，单次最多 8 篇）</strong>
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn btn-primary" onClick={() => void runRefine('merge')} disabled={refining !== null}>
            {refining === 'merge' ? '精炼中…' : '🤖 合并精炼'}
          </button>
          <button className="btn" onClick={() => void runRefine('graph')} disabled={refining !== null}>
            {refining === 'graph' ? '生成中…' : '🧠 生成知识图谱'}
          </button>
          {refineText && (
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(refineText);
              }}
            >
              📋 复制结果
            </button>
          )}
        </div>
        {refineText && (
          <div className="refine-result">
            {refineMode === 'graph' ? <MermaidView code={refineText} /> : <pre className="refine-code">{refineText}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}
