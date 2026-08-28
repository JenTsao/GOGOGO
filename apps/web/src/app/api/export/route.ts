import { NextRequest, NextResponse } from 'next/server';
import { resolveAccessKey } from '@/lib/access';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchRawFile, isGithubConfigured } from '@/lib/github';
import { buildApkg } from '@/lib/apkg';

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

  const auth = req.headers.get('x-access-key');
  if (!auth) return NextResponse.json({ error: '缺少 x-access-key' }, { status: 401 });
  const owner = await resolveAccessKey(auth);
  if (!owner) return NextResponse.json({ error: '访问密钥无效' }, { status: 401 });

  const paths = (Array.isArray(body.paths) ? body.paths : []).filter((p): p is string => typeof p === 'string').slice(0, 20);
  const type = body.type === 'anki' || body.type === 'outline' ? body.type : 'pdf';
  if (paths.length === 0) return NextResponse.json({ error: '没有要导出的笔记' }, { status: 400 });
  if (!isGithubConfigured()) return NextResponse.json({ error: '管理台未配置 GITHUB_REPO' }, { status: 500 });

  // 采集笔记内容
  const docs: { path: string; content: string }[] = [];
  for (const p of paths) {
    try {
      docs.push({ path: p, content: await fetchRawFile(p) });
    } catch {
      // 单篇拉取失败跳过，不阻断整体导出
    }
  }
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

function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

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
      const back = lines
        .slice(1)
        .join('\n')
        .trim()
        .split('\n')
        .map((l) => {
          const img = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(l.trim());
          if (img) return `<img src="${img[2]}" style="max-width:100%">`;
          return escapeHtml(l);
        })
        .join('<br>');
      if (!back) continue;
      cards.push({ front: escapeHtml(head[1]), back });
    }
  }
  return cards;
}

// A4 打印视图（与 compile 页 print 视图同款风格）
function printableHtml(docs: { path: string; content: string }[]): string {
  const body = docs
    .map((d) => `<h1>${escapeHtml(d.path)}</h1>${mdToHtml(stripFrontmatter(d.content))}`)
    .join('<div class="pagebreak"></div>');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>高考复习资料</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
body { font: 12pt/1.7 'Microsoft YaHei', 'PingFang SC', sans-serif; color: #1a1a1a; }
h1 { font-size: 16pt; border-bottom: 2px solid #333; padding-bottom: 4px; }
h2,h3 { color: #1a4d8f; }
pre { background: #f6f8fa; padding: 8px; border-radius: 6px; font-size: 10pt; white-space: pre-wrap; }
blockquote { border-left: 3px solid #1a4d8f; margin: 8px 0; padding: 2px 10px; color: #444; }
li { margin: 2px 0; }
img { max-width: 100%; border: 1px solid #eee; border-radius: 4px; }
.pagebreak { page-break-after: always; }
@media print { .no-print { display: none; } }
</style></head><body>${body}
<script class="no-print">document.title='高考复习资料';window.addEventListener('load',()=>{setTimeout(()=>window.print(),600)});</script>
</body></html>`;
}

// 极简 Markdown → HTML（标题/图片/代码块/引用/列表/段落）
function mdToHtml(md: string): string {
  const out: string[] = [];
  let inCode = false;
  for (const line of md.split('\n')) {
    if (line.trim().startsWith('```')) {
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${escapeHtml(h[2])}</h${h[1].length}>`);
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.trim());
    if (img) {
      out.push(`<img src="${escapeHtml(img[2])}" alt="${escapeHtml(img[1])}">`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      out.push(`<blockquote>${escapeHtml(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      out.push(`<li>${escapeHtml(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    out.push(line.trim() === '' ? '' : `<p>${escapeHtml(line)}</p>`);
  }
  return out.join('\n');
}
