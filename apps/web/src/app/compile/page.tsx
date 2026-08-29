'use client';

import { useEffect, useState } from 'react';

// 菜单3：编译与输出（武器库）
// 资源池勾选笔记/错题 → 三种产物：复习 PDF（浏览器打印，A4 排版）/ Anki 卡片包（真 .apkg，服务端 sql.js 构建）/ 纯文本大纲
// 设计取舍：PDF 用浏览器打印（服务端嵌 CJK 字体体积过大）；.apkg 由 /api/compile/apkg 服务端构建，失败自动降级 TSV
interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
}

interface MistakeItem {
  id: string;
  subject: string;
  tags: string[];
  image_urls: string[];
  created_at: string;
}

interface CompileJob {
  id: string;
  type: 'pdf' | 'anki' | 'outline';
  name: string;
  createdAt: string;
  files: number;
  content: string;
}

const HISTORY_KEY = 'compile-history';
const MAX_FILES = 20;

function loadHistory(): CompileJob[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as CompileJob[];
  } catch {
    return [];
  }
}

function saveHistory(jobs: CompileJob[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(jobs.slice(0, 10)));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 极简 Markdown → HTML（标题/图片/代码块/引用/段落；公式与表格交由原样文本）
function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  for (const line of lines) {
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
    // 图片（错题照片等）：A4 打印视图直接内嵌
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.trim());
    if (img) {
      out.push(`<img src="${escapeHtml(img[2])}" alt="${escapeHtml(img[1])}" style="max-width:100%;border:1px solid #eee;border-radius:4px">`);
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
    if (line.trim() === '') {
      out.push('');
    } else {
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  return out.join('\n');
}

// 大纲：压缩为标题层级 + 关键行
function toOutline(docs: { path: string; content: string }[]): string {
  const parts: string[] = ['高考复习大纲', `生成时间：${new Date().toLocaleString('zh-CN')}`, ''];
  for (const doc of docs) {
    parts.push(`═══ ${doc.path} ═══`);
    for (const line of doc.content.split('\n')) {
      if (/^#{1,4}\s/.test(line)) parts.push(line);
      else if (line.trim().startsWith('[') && line.includes(']')) parts.push(`  ${line.trim()}`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

// Anki 卡片解析：## 标题为正面，标题下内容为背面（服务端 buildApkg 用）
function parseAnkiCards(docs: { path: string; content: string }[]): { front: string; back: string; tags: string[] }[] {
  const cards: { front: string; back: string; tags: string[] }[] = [];
  for (const doc of docs) {
    const sections = doc.content.split(/\n(?=#{2,3}\s)/);
    // 错题卡片的标签从文档头「卡壳标签：#a #b」提取
    const docTags = /^卡壳标签：(.+)$/m.exec(doc.content)?.[1]?.match(/#([^\s#]+)/g)?.map((t) => t.slice(1)) ?? [];
    for (const sec of sections) {
      const lines = sec.split('\n');
      const head = /^#{2,3}\s+(.*)$/.exec(lines[0] ?? '');
      if (!head) continue;
      // 图片行转 <img>（.apkg 字段允许 HTML），其余转义
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
      cards.push({ front: escapeHtml(head[1]), back, tags: docTags });
    }
  }
  return cards;
}

// Anki TSV 降级产物（.apkg 服务失败时）：格式同 parseAnkiCards 的字段约定
function toAnki(docs: { path: string; content: string }[]): string {
  const rows: string[] = ['#separator:tab', '#html:true'];
  for (const card of parseAnkiCards(docs)) {
    rows.push(`${card.front}\t${card.back}`);
  }
  return rows.join('\n');
}

// 打印 HTML：A4 排版，浏览器「打印 → 另存为 PDF」
function toPrintHtml(docs: { path: string; content: string }[]): string {
  const body = docs
    .map((d) => `<section><h1>${escapeHtml(d.path)}</h1>${mdToHtml(d.content)}</section>`)
    .join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>复习资料</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 11pt; line-height: 1.7; color: #222; }
  section { page-break-before: always; }
  section:first-of-type { page-break-before: auto; }
  h1 { font-size: 15pt; border-bottom: 2px solid #333; padding-bottom: 4px; }
  h2 { font-size: 13pt; } h3 { font-size: 12pt; }
  pre { background: #f5f5f5; padding: 8px; border-radius: 4px; font-size: 9.5pt; white-space: pre-wrap; }
  blockquote { border-left: 3px solid #bbb; margin-left: 0; padding-left: 10px; color: #555; }
</style></head><body>${body}</body></html>`;
}

export default function CompilePage() {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [mistakes, setMistakes] = useState<MistakeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // "note:" / "mistake:" 前缀区分来源
  const [type, setType] = useState<'pdf' | 'anki' | 'outline'>('outline');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<CompileJob[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
    fetch('/api/github/tree')
      .then(async (r) => {
        // 必须先判 ok 再 json()：网关/Vercel 的 500 返回 HTML，直接解析会抛「Unexpected token '<'」掩盖真实原因
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { entries?: TreeEntry[] }) => {
        setEntries(data.entries ?? []);
      })
      .catch((e) => setError((e as Error).message));
    // 错题资源池（失败静默：不影响笔记编译）
    fetch('/api/mistakes/pool')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { mistakes?: MistakeItem[] }) => {
        setMistakes(data.mistakes ?? []);
      })
      .catch(() => {});
  }, []);

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const download = (name: string, content: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  // base64 → 二进制下载（.apkg）
  const downloadBase64 = (name: string, b64: string, mime: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const compile = async () => {
    const paths = [...selected];
    if (paths.length === 0) {
      setMessage('请先在左侧资源池勾选笔记');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const docs: { path: string; content: string }[] = [];
      for (const sel of paths.slice(0, MAX_FILES)) {
        // 错题资源：元数据转文本（图片以 URL 引用，Anki 背面可显示）
        if (sel.startsWith('mistake:')) {
          const m = mistakes.find((x) => x.id === sel.slice(8));
          if (m) {
            docs.push({
              path: `[错题] ${m.subject} · ${m.created_at.slice(0, 10)}`,
              content: [
                `学科：${m.subject}`,
                // tags / image_urls 在 schema 中可空，历史或手工插入的行可能为 null，裸 .map 会整页白屏
                `卡壳标签：${(m.tags ?? []).map((t) => `#${t}`).join(' ') || '无'}`,
                // Markdown 图片：PDF 打印视图内嵌、Anki 背面显示照片
                (m.image_urls ?? [])[0] ? `![错题照片](${(m.image_urls ?? [])[0]})` : '无图片',
              ].join('\n'),
            });
          }
          continue;
        }
        const res = await fetch(`/api/github/raw?path=${encodeURIComponent(sel)}`);
        docs.push({ path: sel, content: res.ok ? await res.text() : '' });
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
      const job: CompileJob = {
        id: `${Date.now()}`,
        type,
        name: `复习${type === 'pdf' ? '资料' : type === 'anki' ? '卡片' : '大纲'}-${stamp}`,
        createdAt: new Date().toLocaleString('zh-CN'),
        files: docs.length,
        content: '',
      };

      if (type === 'outline') {
        job.content = toOutline(docs);
        download(`${job.name}.txt`, job.content, 'text/plain;charset=utf-8');
      } else if (type === 'anki') {
        const cards = parseAnkiCards(docs);
        if (cards.length === 0) throw new Error('没有解析出卡片：需要笔记里有 ## 标题 + 内容');
        job.content = toAnki(docs); // 历史记录存 TSV，可重新下载导入
        try {
          // 真 .apkg：服务端 sql.js 构建 SQLite 集合
          const r = await fetch('/api/compile/apkg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deckName: '高考复习', cards }),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
          downloadBase64(`${job.name}.apkg`, data.base64, 'application/octet-stream');
          setMessage(`✅ 已下载 ${data.deckName}.apkg（${data.count} 张卡片），Anki 双击导入即可。`);
        } catch (apkgErr) {
          // 降级：TSV 是 Anki 官方导入格式，功能等价
          download(`${job.name}-anki.txt`, toAnki(docs), 'text/plain;charset=utf-8');
          setMessage(`⚠️ .apkg 构建失败（${(apkgErr as Error).message}），已降级下载 TSV：Anki「文件→导入」选择该文件。`);
        }
      } else {
        // PDF：打开 A4 打印视图，浏览器「打印 → 另存为 PDF」
        const w = window.open('', '_blank');
        if (!w) throw new Error('弹窗被拦截，请允许弹窗后重试');
        w.document.write(toPrintHtml(docs));
        w.document.close();
        job.content = toOutline(docs); // 历史存大纲摘要，可重新打开打印
        setMessage('✅ 已打开打印视图：Ctrl/Cmd + P → 「另存为 PDF」即可导出 A4 文件。');
      }

      const next = [job, ...history].slice(0, 10);
      saveHistory(next);
      setHistory(next);
      setSelected(new Set());
    } catch (e) {
      setMessage(`编译失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const redownload = (job: CompileJob) => {
    if (job.type === 'pdf') {
      // 打印型产物历史仅存摘要，重新下载时提示重编译
      download(`${job.name}-摘要.txt`, job.content, 'text/plain;charset=utf-8');
      return;
    }
    download(`${job.name}.txt`, job.content, 'text/plain;charset=utf-8');
  };

  return (
    <div>
      <h1 className="page-title">编译与输出</h1>

      <div className="split">
        <div className="panel" style={{ maxWidth: 360 }}>
          <strong>资源池（{entries.length} 篇笔记）</strong>
          {error && <p className="placeholder">⚠️ {error}</p>}
          {!error && entries.length === 0 && <p className="placeholder">加载中或仓库无 Markdown 笔记</p>}
          <div style={{ marginTop: 8, maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {entries.map((e) => (
              <label key={e.path} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                <input type="checkbox" checked={selected.has(e.path)} onChange={() => toggle(e.path)} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {e.path}</span>
              </label>
            ))}
          </div>
          <p className="placeholder" style={{ marginTop: 8 }}>已选 {selected.size} 项（单次最多 {MAX_FILES}）</p>

          {mistakes.length > 0 && (
            <>
              <strong style={{ display: 'block', marginTop: 14 }}>📕 错题（{mistakes.length}）</strong>
              <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {mistakes.map((m) => (
                  <label key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(`mistake:${m.id}`)}
                      onChange={() => toggle(`mistake:${m.id}`)}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📕 [{m.subject}] {(m.tags ?? []).map((t) => `#${t}`).join(' ')} · {(m.created_at ?? '').slice(0, 10)}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <strong>编译设置</strong>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
            {(
              [
                ['outline', '📋 纯文本大纲', '标题层级 + 要点，.txt'],
                ['anki', '📱 Anki 卡片包', 'TSV 导入格式（## 标题=正面，内容=背面）'],
                ['pdf', '📄 复习 PDF（A4）', '打开打印视图 → 另存为 PDF'],
              ] as const
            ).map(([v, label, hint]) => (
              <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" checked={type === v} onChange={() => setType(v)} />
                <span>
                  <strong>{label}</strong>
                  <span className="placeholder"> — {hint}</span>
                </span>
              </label>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 14 }} onClick={compile} disabled={busy}>
            {busy ? '编译中…' : '⚙️ 一键编译'}
          </button>
          {message && <p className="placeholder" style={{ marginTop: 10 }}>{message}</p>}
        </div>
      </div>

      <div className="panel">
        <strong>历史记录（最近 10 次）</strong>
        {history.length === 0 && <p className="placeholder">暂无编译产物</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {history.map((job) => (
            <div
              key={job.id}
              style={{ border: '1px solid #eee', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span style={{ fontSize: 14 }}>
                {job.type === 'pdf' ? '📄' : job.type === 'anki' ? '📱' : '📋'} {job.name}
                <span className="placeholder"> · {job.files} 篇 · {job.createdAt}</span>
              </span>
              <button className="btn btn-ghost" onClick={() => redownload(job)}>
                重新下载
              </button>
            </div>
          ))}
        </div>
        {history.length > 0 && (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 10 }}
            onClick={() => {
              saveHistory([]);
              setHistory([]);
            }}
          >
            清空历史
          </button>
        )}
      </div>
    </div>
  );
}
