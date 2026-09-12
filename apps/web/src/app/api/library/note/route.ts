import { NextRequest, NextResponse } from 'next/server';
import { fetchRawFile, isGithubConfigured, rawUrl } from '@/lib/github';
import { extractHeadings, renderMarkdown } from '@/lib/markdown';

export const dynamic = 'force-dynamic';

// frontmatter tags 解析：兼容 `tags: [a, b]` 行内与 `tags:` + `- a` 块级两种写法
function parseFrontmatterTags(md: string): string[] {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1];
  if (!fm) return [];
  const out: string[] = [];
  const inline = /^tags:\s*\[([^\]]*)\]/m.exec(fm);
  if (inline) {
    for (const t of inline[1].split(',')) {
      const v = t.trim().replace(/^["']|["']$/g, '');
      if (v) out.push(v);
    }
    return out;
  }
  const start = fm.search(/^tags:\s*(#.*)?$/m);
  if (start < 0) return out;
  for (const line of fm.slice(start).split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const li = /^\s+-\s+(.+)$/.exec(line);
    if (!li) break; // 离开列表区即停
    const v = li[1].trim().replace(/^["']|["']$/g, '');
    if (v) out.push(v);
  }
  return out;
}

// 相对路径 → 仓库绝对路径：逐段消解 ./ 与 ../，再交给 rawUrl 分段编码
function resolveRelative(dir: string, rel: string): string {
  const segs = (dir + rel).split('/');
  const out: string[] = [];
  for (const seg of segs) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

// GET /api/library/note?path=docs/数学/导数.md → 渲染后的 HTML + 大纲 + 标签
// 知识库阅读区的服务端渲染入口：复用导出同源的 Markdown 引擎（callout/公式/双链/任务列表全支持）
export async function GET(req: NextRequest) {
  if (!isGithubConfigured()) {
    return NextResponse.json({ error: '未配置 GITHUB_REPO（格式 owner/repo）' }, { status: 400 });
  }
  const path = req.nextUrl.searchParams.get('path');
  if (!path) return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
  try {
    const md = await fetchRawFile(path);
    let html = renderMarkdown(md);
    // 笔记内相对引用的图片 → raw.githubusercontent 直链（外链与 data: 不动）
    const dir = path.includes('/') ? `${path.slice(0, path.lastIndexOf('/') + 1)}` : '';
    html = html.replace(/<img\b[^>]*?\ssrc="([^"]*)"/g, (full, src: string) => {
      if (/^(https?:|data:|\/)/i.test(src)) return full;
      return full.replace(`src="${src}"`, `src="${rawUrl(resolveRelative(dir, src))}"`);
    });
    return NextResponse.json({
      html,
      headings: extractHeadings(md),
      tags: parseFrontmatterTags(md),
    });
  } catch (e) {
    return NextResponse.json({ error: `读取失败：${(e as Error).message}` }, { status: 502 });
  }
}
