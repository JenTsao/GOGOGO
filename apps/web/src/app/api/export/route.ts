import { NextRequest, NextResponse } from 'next/server';
import { getUserByAccessKey } from '@/lib/access';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchRawFile, isGithubConfigured } from '@/lib/github';
import { buildApkg } from '@/lib/apkg';
import { renderMarkdown, stripFrontmatter } from '@/lib/markdown';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/export { paths: string[], type: 'pdf'|'anki'|'outline' }（header x-access-key 鉴权）
// L4 exportNote 工具的服务端编译端点：产物上传 Supabase Storage（compilations 公开桶），
// 记录 knowledge_compilations 表，返回下载 URL。蓝皮书「编译任务记录」管道闭环。
export async function POST(req: NextRequest) {
  let body: { paths?: unknown; type?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const user = await getUserByAccessKey(req.headers.get('x-access-key'));
  if (!user) return NextResponse.json({ error: '访问密钥无效或缺失' }, { status: 401 });
  const owner = user.userId;

  const paths = (Array.isArray(body.paths) ? body.paths : []).filter((p): p is string => typeof p === 'string').slice(0, 20);
  const type = body.type === 'anki' || body.type === 'outline' ? body.type : 'pdf';
  if (paths.length === 0) return NextResponse.json({ error: '没有要导出的笔记' }, { status: 400 });
  if (!isGithubConfigured()) return NextResponse.json({ error: '管理台未配置 GITHUB_REPO' }, { status: 500 });

  // 采集笔记内容：并行拉取（≤20 篇，串行时最坏 20 个 HTTP 往返；失败的单篇跳过不阻断整体）
  const settled = await Promise.allSettled(
    paths.map(async (p) => ({ path: p, content: await fetchRawFile(p) }))
  );
  const docs = settled
    .filter((r): r is PromiseFulfilledResult<{ path: string; content: string }> => r.status === 'fulfilled')
    .map((r) => r.value);
  if (docs.length === 0) return NextResponse.json({ error: '所有笔记均拉取失败' }, { status: 502 });

  // ---------- 三种产物 ----------
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  let buf: Buffer;
  let filename: string;
  let contentType: string;

  if (type === 'anki') {
    const cards = parseCards(docs);
    if (cards.length === 0) return NextResponse.json({ error: '笔记中没有 ## 标题结构，无法生成卡片' }, { status: 422 });
    try {
      buf = await buildApkg('高考复习', cards);
    } catch (e) {
      return NextResponse.json({ error: `apkg 构建失败：${(e as Error).message}` }, { status: 500 });
    }
    filename = `export-${stamp}.apkg`;
    contentType = 'application/octet-stream';
  } else if (type === 'outline') {
    const text = docs.map((d) => `## ${d.path}\n\n${stripFrontmatter(d.content)}`).join('\n\n---\n\n');
    buf = Buffer.from(text, 'utf8');
    filename = `outline-${stamp}.txt`;
    contentType = 'text/plain; charset=utf-8';
  } else {
    // pdf：服务端无 CJK PDF 库（嵌入字体体积过大），产出 A4 打印样式 HTML，
    // 浏览器打开 → Ctrl+P → 另存为 PDF，即得复习 PDF
    const html = printableHtml(docs);
    buf = Buffer.from(html, 'utf8');
    filename = `review-${stamp}.html`;
    contentType = 'text/html; charset=utf-8';
  }

  // 上传 Storage（compilations 公开桶，按 owner 隔离目录）
  const sb = supabaseAdmin();
  const objectPath = `${owner}/${filename}`;
  const { error: upErr } = await sb.storage.from('compilations').upload(objectPath, buf, { contentType, upsert: true });
  if (upErr) return NextResponse.json({ error: `产物上传失败：${upErr.message}` }, { status: 500 });
  const { data: pub } = sb.storage.from('compilations').getPublicUrl(objectPath);

  // 记录编译任务（knowledge_compilations：蓝皮书第 10 张表终于有主了）
  const { error: recErr } = await sb.from('knowledge_compilations').insert({
    user_id: owner,
    compiled_type: type,
    download_url: pub.publicUrl,
    status: 'done',
  });
  if (recErr) {
    // 产物已可下载，记录失败不阻断（返回时附带提示）
    return NextResponse.json({ downloadUrl: pub.publicUrl, type, files: docs.length, warn: `编译记录写入失败：${recErr.message}` });
  }

  return NextResponse.json({ downloadUrl: pub.publicUrl, type, files: docs.length });
}

// ---------- 服务端编译工具 ----------

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Anki 卡片解析（与 compile 页同一约定：## 标题=正面，内容=背面，图片行转 <img>）
function parseCards(docs: { path: string; content: string }[]) {
  const cards: { front: string; back: string; tags?: string[] }[] = [];
  for (const doc of docs) {
    const sections = doc.content.split(/\n(?=#{2,3}\s)/);
    for (const sec of sections) {
      const lines = sec.split('\n');
      const head = /^#{2,3}\s+(.*)$/.exec(lines[0] ?? '');
      if (!head) continue;
      // 背面交给 Markdown 引擎渲染：表格/加粗/链接/行内代码/==高亮== 此前全部被 escape 丢失
      const back = renderMarkdown(lines.slice(1).join('\n'));
      if (!back.trim()) continue;
      cards.push({ front: escapeHtml(head[1]), back });
    }
  }
  return cards;
}

// A4 打印视图（与 compile 页 print 视图同款风格）
function printableHtml(docs: { path: string; content: string }[]): string {
  // 正文交给 Markdown 引擎（内部已剥离 frontmatter 并做 Obsidian 语法降级），不再手工逐行转义
  const body = docs
    .map((d) => `<h1>${escapeHtml(d.path)}</h1>${renderMarkdown(d.content)}`)
    .join('<div class="pagebreak"></div>');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>高考复习资料</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
body { font: 12pt/1.7 'Microsoft YaHei', 'PingFang SC', sans-serif; color: #1a1a1a; }
h1 { font-size: 16pt; border-bottom: 2px solid #333; padding-bottom: 4px; }
h2,h3,h4 { color: #1a4d8f; }
pre { background: #f6f8fa; padding: 8px; border-radius: 6px; font-size: 10pt; white-space: pre-wrap; }
code { font-family: Consolas, 'Courier New', monospace; background: #f2f4f7; border-radius: 3px; padding: 0 3px; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #1a4d8f; margin: 8px 0; padding: 2px 10px; color: #444; }
li { margin: 2px 0; }
img { max-width: 100%; border: 1px solid #eee; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 11pt; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f0f4fa; }
mark { background: #fff3bf; padding: 0 2px; border-radius: 3px; }
.md-tag { color: #7c3aed; font-size: 10.5pt; }
.md-wikilink { color: #1a4d8f; border-bottom: 1px dashed #9db8dd; }
.pagebreak { page-break-after: always; }
@media print { .no-print { display: none; } }
</style></head><body>${body}
<script class="no-print">document.title='高考复习资料';window.addEventListener('load',()=>{setTimeout(()=>window.print(),600)});</script>
</body></html>`;
}
