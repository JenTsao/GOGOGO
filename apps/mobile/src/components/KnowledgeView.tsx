import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useSettingsStore } from '@/store/settingsStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';

// 知识库：按需从 GitHub 拉取 Obsidian 目录树，点击单篇下载 Markdown 并渲染（缓存后离线可读）
interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let cur = root;
    parts.forEach((name, i) => {
      const isLeaf = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === name && !!c.children.length === !isLeaf);
      if (!next) {
        next = { name, path: parts.slice(0, i + 1).join('/'), children: [] };
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
  if (node.children.length > 0) {
    return (
      <View>
        <TouchableOpacity style={[styles.row, { paddingLeft: 4 + depth * 12 }]} onPress={() => setOpen((v) => !v)}>
          <Text style={styles.folder}>
            {open ? '▾ ' : '▸ '}
            {node.name}
          </Text>
        </TouchableOpacity>
        {open &&
          node.children.map((c) => (
            <TreeItem key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={[styles.row, { paddingLeft: 4 + depth * 12 }, selected === node.path && styles.rowActive]}
      onPress={() => onSelect(node.path)}
    >
      <Text style={[styles.file, selected === node.path && styles.fileActive]}>📄 {node.name}</Text>
    </TouchableOpacity>
  );
}

// [[双链]] → 加粗占位（Phase 3 接入全文检索后实现真跳转）
const renderContent = (md: string) => md.replace(/\[\[(.+?)\]\]/g, '**$1**');

export function KnowledgeView() {
  const { githubRepo, githubBranch } = useSettingsStore();
  const { cache, save } = useKnowledgeStore();
  const [paths, setPaths] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const repo = githubRepo.trim();
  const branch = githubBranch.trim() || 'main';
  const tree = useMemo(() => (paths ? buildTree(paths) : []), [paths]);
  // 优先用缓存（离线可读），未缓存再下载
  const content = selected ? (cache[selected] ?? null) : null;

  useEffect(() => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      setPaths(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setPaths(null);
    fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (cancelled) return;
        setPaths(
          (data.tree as { path: string; type: string }[])
            .filter((n) => n.type === 'blob' && n.path.endsWith('.md'))
            .map((n) => n.path)
        );
      })
      .catch((e) => {
        if (!cancelled) setError(`拉取目录树失败（${e}）`);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, branch]);

  const openFile = useCallback(
    async (path: string) => {
      setSelected(path);
      if (cache[path]) return;
      setLoading(true);
      try {
        const r = await fetch(
          `https://raw.githubusercontent.com/${repo}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`
        );
        const text = await r.text();
        if (r.ok) save(path, text);
      } catch {
        // 静默：下次点开重试
      } finally {
        setLoading(false);
      }
    },
    [repo, branch, cache, save]
  );

  if (!repo) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          未配置笔记仓库。请到「我的」Tab 填写 GitHub 仓库（格式 owner/repo），知识库将按需拉取 Obsidian Markdown。
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {error && <Text style={styles.errorText}>⚠️ {error}</Text>}
      {!error && paths === null && <Text style={styles.emptyText}>加载目录树中…</Text>}
      {!error && paths !== null && paths.length === 0 && <Text style={styles.emptyText}>仓库中没有 Markdown 笔记</Text>}

      {/* 目录树（水平区） */}
      {tree.length > 0 && (
        <ScrollView style={styles.tree} horizontal={false} nestedScrollEnabled>
          {tree.map((n) => (
            <TreeItem key={n.path} node={n} depth={0} selected={selected} onSelect={openFile} />
          ))}
        </ScrollView>
      )}

      {/* 正文渲染 */}
      {selected && (
        <Text style={styles.readerTitle}>
          {selected}
          {cache[selected] ? ' · 已缓存' : ''}
          {loading ? ' · 下载中…' : ''}
        </Text>
      )}
      <ScrollView style={styles.reader} nestedScrollEnabled>
        {content !== null ? (
          <Markdown style={mdStyles}>{renderContent(content)}</Markdown>
        ) : (
          <Text style={styles.emptyText}>点击上方文件阅读（首次将下载并缓存）</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', padding: 20 },
  emptyText: { color: '#999', fontSize: 14, lineHeight: 22 },
  errorText: { color: '#c62828', fontSize: 13, marginBottom: 8 },
  tree: { maxHeight: 220, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#eee', padding: 8 },
  row: { paddingVertical: 6 },
  rowActive: { backgroundColor: '#eef2ff', borderRadius: 8 },
  folder: { fontSize: 14, fontWeight: '700', color: '#333' },
  file: { fontSize: 14, color: '#555' },
  fileActive: { color: '#111', fontWeight: '700' },
  readerTitle: { marginTop: 10, marginBottom: 4, fontSize: 12, color: '#888' },
  reader: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#eee', padding: 12 },
});

const mdStyles = {
  body: { color: '#333', fontSize: 15, lineHeight: 24 },
  heading1: { fontSize: 22, fontWeight: '700' as const, marginVertical: 8, color: '#111' },
  heading2: { fontSize: 19, fontWeight: '700' as const, marginVertical: 8, color: '#111' },
  heading3: { fontSize: 16, fontWeight: '700' as const, marginVertical: 6, color: '#222' },
  code_inline: { backgroundColor: '#f2f2f2', fontFamily: 'monospace', fontSize: 13, color: '#c7254e' },
  fence: { backgroundColor: '#f6f8fa', borderRadius: 8, padding: 10, fontFamily: 'monospace', fontSize: 12, color: '#333' },
  strong: { fontWeight: '700' as const, color: '#111' },
  blockquote: { backgroundColor: '#fafafa', borderLeftWidth: 3, borderLeftColor: '#ccc', paddingLeft: 10, paddingVertical: 4 },
  link: { color: '#1a73e8' },
  bullet_list_icon: { color: '#888' },
  hr: { backgroundColor: '#eee', height: 1, marginVertical: 10 },
};
