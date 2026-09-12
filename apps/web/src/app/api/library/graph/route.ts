import { NextResponse } from 'next/server';
import { fetchRawFile, fetchRepoTree, githubConfig, isGithubConfigured } from '@/lib/github';

export const dynamic = 'force-dynamic';

// 图谱索引：全库扫描 [[双链]] 构建笔记关系图（图谱视图 / 反链 / 出链 / 未解析链接共用数据源）。
// Supabase 只存元数据不存正文，链接关系必须扫 GitHub 原文——内存缓存 10 分钟兜底，
// 冷启动一次全量（并发 6，数百篇约 10~20 秒），命中缓存后毫秒级返回。

const CACHE_TTL = 10 * 60 * 1000;

interface GraphNode {
  path: string;
  folder: string;
  out: number; // 出链数（解析成功的）
  back: number; // 反链数
  aliases: string[];
}

interface GraphPayload {
  nodes: GraphNode[];
  edges: [string, string][];
  unresolved: Record<string, number>; // 全局未解析目标 → 出现次数（左栏汇总用）
  unresolvedBy: Record<string, string[]>; // 按笔记记录：笔记路径 → 其未解析双链目标（出链面板 ❓ 用）
  generatedAt: string;
}

let cache: { key: string; at: number; data: GraphPayload } | null = null;

// 简单并发池（与 knowledgeSync 同思路，此处独立小实现避免跨模块耦合）
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<(R | null)[]> {
  const results = new Array<R | null>(items.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]);
      } catch {
        // 单篇失败按 null 处理：该篇无出链，但不影响图谱其余部分
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// 双链目标 → 完整仓库路径（含 .md）：全路径（含/不含 .md）→ 文件名（Obsidian 最短路径）→ frontmatter 别名
// 返回值必须与 nodes.path 同构（含 .md），否则图谱边端点对不上节点、反链匹配恒为空
function resolveLink(
  target: string,
  byPath: Map<string, string>,
  byBase: Map<string, string>,
  byAlias: Map<string, string>
): string | null {
  const t = target.trim().replace(/#.*$/, '').replace(/\^[\w-]+$/, '').replace(/^["']|["']$/g, '');
  if (!t) return null;
  const stripped = t.replace(/\.md$/, '');
  return byPath.get(stripped) ?? byPath.get(t) ?? byBase.get(stripped) ?? byAlias.get(stripped) ?? byAlias.get(t) ?? null;
}

// 提取正文双链目标（剥代码块；![[图片]] 嵌入不算笔记节点）
function extractWikilinks(md: string): string[] {
  const body = md.replace(/```[\s\S]*?```/g, '').replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  return [...body.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)]
    .filter((m) => !(m[1] === '!' && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(m[2])))
    .map((m) => m[2].split('|')[0].trim())
    .filter(Boolean);
}

// frontmatter aliases（Obsidian 别名）：兼容 `aliases: [a, b]` 行内与 `aliases:` + `- a` 块级
function extractAliases(md: string): string[] {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1];
  if (!fm) return [];
  const out: string[] = [];
  const keys = /^(aliases|alias):\s*/;
  const inline = fm.split(/\r?\n/).find((l) => keys.test(l) && l.includes('['));
  if (inline) {
    const inner = inline.replace(keys, '').replace(/^\[|\]$/g, '');
    for (const t of inner.split(',')) {
      const v = t.trim().replace(/^["']|["']$/g, '');
      if (v) out.push(v);
    }
    return out;
  }
  const startLine = fm.split(/\r?\n/).findIndex((l) => keys.test(l));
  if (startLine < 0) return out;
  for (const line of fm.split(/\r?\n/).slice(startLine + 1)) {
    if (!line.trim()) continue;
    const li = /^\s+-\s+(.+)$/.exec(line);
    if (!li) break;
    const v = li[1].trim().replace(/^["']|["']$/g, '');
    if (v) out.push(v);
  }
  return out;
}

// GET /api/library/graph → { nodes, edges, unresolved }
export async function GET() {
  if (!isGithubConfigured()) {
    return NextResponse.json({ error: '未配置 GITHUB_REPO（格式 owner/repo）' }, { status: 400 });
  }
  const key = `${githubConfig.repo}@${githubConfig.branch}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json({ ...cache.data, cached: true });
  }

  const { entries } = await fetchRepoTree();
  const paths = entries.map((e) => e.path);
  // 去掉 .md 的目标 → 完整仓库路径（双链常省略扩展名）
  const byPath = new Map<string, string>();
  for (const p of paths) byPath.set(p.replace(/\.md$/, ''), p);
  const contents = await mapPool(entries, 6, (e) => fetchRawFile(e.path));

  // 别名/文件名索引（同名取先出现的：Obsidian 对歧义链接也会提示而非随机）
  const byBase = new Map<string, string>();
  const byAlias = new Map<string, string>();
  const aliasesByPath = new Map<string, string[]>();
  contents.forEach((md, i) => {
    if (!md) return;
    const base = paths[i].split('/').pop()?.replace(/\.md$/, '') ?? '';
    if (base && !byBase.has(base)) byBase.set(base, paths[i]);
    const aliases = extractAliases(md);
    if (aliases.length) {
      aliasesByPath.set(paths[i], aliases);
      for (const a of aliases) if (!byAlias.has(a)) byAlias.set(a, paths[i]);
    }
  });

  const backCount = new Map<string, number>();
  const edges: [string, string][] = [];
  const unresolved: Record<string, number> = {};
  const unresolvedBy: Record<string, string[]> = {};
  const outCount = new Map<string, number>();

  contents.forEach((md, i) => {
    if (!md) return;
    const src = paths[i];
    const seen = new Set<string>();
    const missing = new Set<string>();
    for (const target of extractWikilinks(md)) {
      const resolved = resolveLink(target, byPath, byBase, byAlias);
      if (!resolved || resolved === src || seen.has(resolved)) {
        if (!resolved) {
          unresolved[target] = (unresolved[target] ?? 0) + 1;
          missing.add(target);
        }
        continue;
      }
      seen.add(resolved);
      edges.push([src, resolved]);
      outCount.set(src, (outCount.get(src) ?? 0) + 1);
      backCount.set(resolved, (backCount.get(resolved) ?? 0) + 1);
    }
    if (missing.size > 0) unresolvedBy[src] = [...missing];
  });

  const data: GraphPayload = {
    nodes: paths.map((p) => ({
      path: p,
      folder: p.includes('/') ? p.split('/')[0] : '/',
      out: outCount.get(p) ?? 0,
      back: backCount.get(p) ?? 0,
      aliases: aliasesByPath.get(p) ?? [],
    })),
    edges,
    unresolved,
    unresolvedBy,
    generatedAt: new Date().toISOString(),
  };
  cache = { key, at: Date.now(), data };
  return NextResponse.json(data);
}
