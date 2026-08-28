import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useSettingsStore } from '@/store/settingsStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { fetchRepoPaths, fetchRawFile } from '@/lib/github';

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

// ---------- Markdown 预处理：frontmatter → LaTeX 轻量化 → [[双链]] 转跳转链接 ----------

// Obsidian YAML frontmatter 会渲染成割裂的横线与键值文本，直接剥离
function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

// 上下标 Unicode 映射（高考数学公式的高频场景）
const SUPER: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', 'n': 'ⁿ', 'i': 'ⁱ', 'k': 'ᵏ',
};
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'n': 'ₙ',
};
const toSup = (s: string) => [...s].map((c) => SUPER[c] ?? `^${c}`).join('');
const toSub = (s: string) => [...s].map((c) => SUB[c] ?? `_${c}`).join('');

// Expo Go 下无法用原生数学库渲染 KaTeX，取轻量 Unicode 近似：比裸 LaTeX 标记可读得多
function texToText(tex: string): string {
  let s = tex;
  const map: [RegExp, string | ((m: string, a: string, b: string) => string)][] = [
    [/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_m, a, b) => `(${a})/(${b})`],
    [/\\sqrt\{([^{}]+)\}/g, (_m, a) => `√(${a})`],
    [/\\(?:left|right)\b/g, ''],
    [/\\times/g, '×'], [/\\cdot/g, '·'], [/\\pm/g, '±'], [/\\mp/g, '∓'],
    [/\\leq(?:s)?|\\le\b/g, '≤'], [/\\geq(?:s)?|\\ge\b/g, '≥'], [/\\neq|\\ne\b/g, '≠'],
    [/\\approx/g, '≈'], [/\\infty/g, '∞'], [/\\sum/g, 'Σ'], [/\\prod/g, 'Π'], [/\\int/g, '∫'],
    [/\\partial/g, '∂'], [/\\nabla/g, '∇'],
    [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'], [/\\delta/g, 'δ'], [/\\epsilon|\\varepsilon/g, 'ε'],
    [/\\theta/g, 'θ'], [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'], [/\\pi/g, 'π'], [/\\rho/g, 'ρ'],
    [/\\sigma/g, 'σ'], [/\\tau/g, 'τ'], [/\\varphi|\\phi/g, 'φ'], [/\\omega/g, 'ω'],
    [/\\Delta/g, 'Δ'], [/\\Omega/g, 'Ω'], [/\\Sigma/g, 'Σ'], [/\\Lambda/g, 'Λ'],
    [/\\rightarrow|\\to\b/g, '→'], [/\\Rightarrow/g, '⇒'], [/\\leftrightarrow/g, '↔'],
    [/\\in\b/g, '∈'], [/\\subset/g, '⊂'], [/\\cup/g, '∪'], [/\\cap/g, '∩'], [/\\forall/g, '∀'],
    [/\\lim/g, 'lim'], [/\\log/g, 'log'], [/\\ln/g, 'ln'], [/\\sin/g, 'sin'], [/\\cos/g, 'cos'], [/\\tan/g, 'tan'],
  ];
  for (const [re, rep] of map) s = s.replace(re, rep as string);
  s = s.replace(/\^\{([^{}]+)\}|\^(\w)/g, (_m, g1, g2) => toSup(g1 ?? g2));
  s = s.replace(/_\{([^{}]+)\}|_(\w)/g, (_m, g1, g2) => toSub(g1 ?? g2));
  return s.replace(/[{}]/g, '').trim();
}

// 代码围栏内的内容不转换（数学/双链替换只作用于正文段落）
function transformOutsideFences(md: string, fn: (seg: string) => string): string {
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((seg) => (seg.startsWith('```') ? seg : fn(seg)))
    .join('');
}

function mathLite(md: string): string {
  // 块级 $$...$$ 加粗成行，行内 $...$ 原文内联
  return md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => `\n\n**${texToText(tex)}**\n\n`)
    .replace(/\$([^$\n]+?)\$/g, (_m, tex) => texToText(tex));
}

// [[目标|别名]] → [别名](wiki:目标)，由 onLinkPress 拦截实现库内跳转
function wikilinkToMd(md: string): string {
  return md.replace(/\[\[(.+?)\]\]/g, (_m, inner: string) => {
    const [target, alias] = inner.split('|');
    const label = (alias ?? target).trim();
    return `[${label}](wiki:${encodeURIComponent(target.trim())})`;
  });
}

const renderContent = (md: string) =>
  wikilinkToMd(transformOutsideFences(stripFrontmatter(md), mathLite));

export function KnowledgeView() {
  const { githubRepo, githubBranch } = useSettingsStore();
  const { cache, save } = useKnowledgeStore();
  const [paths, setPaths] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wikiMiss, setWikiMiss] = useState<string | null>(null); // 双链未命中提示

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
    fetchRepoPaths(repo, branch)
      .then((list) => {
        if (!cancelled) setPaths(list);
      })
      .catch((e) => {
        if (cancelled) return;
        // github.ts 内置 10 秒 AbortController 超时，超时单独给出可读提示
        if ((e as Error)?.name === 'AbortError') setError('拉取目录树超时，请检查网络后重试');
        else setError(`拉取目录树失败（${e}）`);
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
        const text = await fetchRawFile(repo, branch, path);
        save(path, text);
      } catch {
        // 静默：下次点开重试
      } finally {
        setLoading(false);
      }
    },
    [repo, branch, cache, save]
  );

  // 双链解析：精确路径 → 目录路径后缀 → 文件名匹配（Obsidian 习惯按文件名引用）
  const resolveWiki = useCallback(
    (target: string): string | null => {
      if (!paths) return null;
      const t = target.trim().replace(/\.md$/, '');
      return (
        paths.find((p) => p.replace(/\.md$/, '') === t) ??
        paths.find((p) => p.replace(/\.md$/, '').endsWith('/' + t)) ??
        paths.find((p) => p.split('/').pop()?.replace(/\.md$/, '') === t) ??
        null
      );
    },
    [paths]
  );

  const handleLinkPress = useCallback(
    (url: string): boolean => {
      if (!url.startsWith('wiki:')) return false; // 外部链接走系统浏览器默认行为
      const target = decodeURIComponent(url.slice(5));
      const hit = resolveWiki(target);
      if (hit) {
        setWikiMiss(null);
        openFile(hit);
      } else {
        setWikiMiss(target);
      }
      return true;
    },
    [resolveWiki, openFile]
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
      {wikiMiss && <Text style={styles.wikiMiss}>双链「{wikiMiss}」未找到对应笔记</Text>}
      <ScrollView style={styles.reader} nestedScrollEnabled>
        {content !== null ? (
          <Markdown style={mdStyles} onLinkPress={handleLinkPress}>
            {renderContent(content)}
          </Markdown>
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
  wikiMiss: { fontSize: 12, color: '#c62828', marginTop: 4 },
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
