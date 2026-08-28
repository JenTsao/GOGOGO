'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Editor, { type OnMount } from '@monaco-editor/react';

// 菜单1：知识工坊（Phase 1：文件树预览 + 只读编辑器）
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
    nodes.sort((a, b) => (b.children.length - a.children.length) || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

// 递归文件树节点
function TreeItem({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
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
            <TreeItem key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
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
        color: selected === node.path ? '#111' : '#555',
        fontWeight: selected === node.path ? 700 : 400,
        background: selected === node.path ? '#eef2ff' : undefined,
        borderRadius: 6,
      }}
      onClick={() => onSelect(node.path)}
    >
      📄 {node.name}
    </div>
  );
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
  const [paths, setPaths] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const tree = useMemo(() => (paths ? buildTree(paths) : []), [paths]);

  useEffect(() => {
    fetch('/api/github/tree')
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        setPaths(data.entries.map((e: { path: string }) => e.path));
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const openFile = useCallback(async (path: string) => {
    setSelected(path);
    setLoading(true);
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

  const onMount: OnMount = (editor) => {
    editor.updateOptions({ readOnly: true });
  };

  return (
    <div>
      <h1 className="page-title">知识工坊</h1>
      <div className="split workshop-split">
        <div className="panel">
          <strong>GitHub 文件树（Obsidian 目录）</strong>
          {error && <p className="placeholder">⚠️ {error}</p>}
          {!error && paths === null && <p className="placeholder">加载目录树中…</p>}
          {paths !== null && paths.length === 0 && (
            <p className="placeholder">目录树为空。请在 .env.local 配置 GITHUB_REPO=owner/repo（Obsidian 仓库）。</p>
          )}
          <div className="tree">
            {tree.map((n) => (
              <TreeItem key={n.path} node={n} depth={0} selected={selected} onSelect={openFile} />
            ))}
          </div>
        </div>
        <div className="panel">
          <strong>Monaco Editor（只读 · Phase 2 开放编辑）</strong>
          <p className="placeholder" style={{ margin: '6px 0' }}>
            {selected ? `当前：${selected}` : '点击左侧文件预览 Markdown'}
            {loading && ' · 加载中…'}
          </p>
          <div className="editor-wrap">
            <Editor
              language="markdown"
              theme="vs"
              value={content}
              onMount={onMount}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                wordWrap: 'on',
                fontSize: 14,
                lineNumbers: 'off',
              }}
            />
          </div>
        </div>
      </div>
      <div className="panel">
        <strong>AI 精炼工具栏</strong>
        <p className="placeholder">
          勾选多篇笔记 → “🤖 合并精炼” / “🧠 生成知识图谱”。Phase 2 接入 DeepSeek 后实现。
        </p>
      </div>
    </div>
  );
}
