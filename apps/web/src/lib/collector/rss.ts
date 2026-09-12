// RSS/Atom 解析 + 正文抽取：零第三方依赖（AGENTS.md 硬性约束：本地禁止安装依赖）。
// 用正则而非 XML parser 的代价是无法处理畸形 XML，收益是省一个依赖且 RSS 结构足够规整；
// 解析失败按源静默跳过——采集是「广撒网」，单源失败不该中断整轮。

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
  /** RSS 自带的正文（可能是全文，也可能只有摘要） */
  content: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#8217': '’',
  '#8216': '‘',
  '#8220': '“',
  '#8221': '”',
  '#8212': '—',
  '#8211': '–',
  '#8230': '…',
};

/** XML/HTML 实体解码：数字实体（含十六进制）与常见命名实体 */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z#0-9]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** 去掉 CDATA 包裹（保留内部原文）与所有 HTML 标签 */
function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/** 压缩空白：正文抽取后常见大量连续换行与缩进 */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function pickTag(block: string, tag: string): string {
  // 命名空间前缀（content:encoded / dc:date）统一用 [\w:-]+ 匹配
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? unwrapCdata(m[1]).trim() : '';
}

function pickLink(block: string): string {
  // Atom: <link href="..."/>（可能带 rel 属性）；RSS: <link>url</link>
  const atom = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (atom) return atom[1].trim();
  const rss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  return rss ? unwrapCdata(rss[1]).trim() : '';
}

/**
 * 正文抽取：RSS 的 description 常只有一两句摘要，撑不起一套阅读题。
 * 优先 content:encoded（很多源给全文）→ description → 抓原文页。
 * 无 <p> 标签时（部分源是纯文本 HTML）退回整体去标签。
 */
export function extractText(rawHtml: string): string {
  if (!rawHtml) return '';
  // Atom 的 <content type="html"> 与部分 RSS 会把整段 HTML 做实体编码（&lt;p&gt;…），
  // 不先解码就既匹配不到 <p> 结构、也剥不掉标签，正文会带着 &lt;p&gt; 原样落库。
  // 仅对确实被编码过的内容解码，避免影响正常 HTML（内容里本就想显示 < 的极少数情况）。
  const raw = /&lt;[a-z/!]/i.test(rawHtml) ? decodeEntities(rawHtml) : rawHtml;
  const withoutNoise = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const paragraphs = [...withoutNoise.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((m) => collapse(decodeEntities(stripTags(m[1]))))
    .filter((p) => p.length > 40); // 过短的多半是图注、按钮文案

  // 判据用段数而非总长度：两段以上说明 <p> 结构规整，按段拼接能保留段落边界；
  // 单段往往只是图注或 RSS 摘要，退回整体去标签反而更完整。
  if (paragraphs.length >= 2) return paragraphs.join('\n\n');

  // 退回：整块去标签（无 <p> 结构的源，或只有一段）
  return collapse(decodeEntities(stripTags(withoutNoise)));
}

/** 正文太短时回源站抓一次；失败静默返回空串（调用方决定降级） */
export async function fetchFullText(url: string, timeoutMs = 12000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        // 部分站点对无 UA 请求直接 403
        'User-Agent': 'Mozilla/5.0 (compatible; GaokaoCoPilot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return '';
    const html = await res.text();
    return extractText(html);
  } catch {
    return '';
  }
}

/**
 * 拉取并解析一个 feed，自动兼容 RSS 2.0 与 Atom。
 * 只返回有 title + url 的条目（无链接的条目无法溯源，也不该进素材池）。
 */
export async function fetchFeed(sourceUrl: string, timeoutMs = 15000): Promise<FeedItem[]> {
  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GaokaoCoPilot/1.0)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];

  const items: FeedItem[] = [];
  for (const m of blocks) {
    const block = m[1];
    const title = collapse(decodeEntities(stripTags(pickTag(block, 'title'))));
    const url = pickLink(block);
    if (!title || !/^https?:\/\//.test(url)) continue;

    const dateRaw =
      pickTag(block, 'pubDate') ||
      pickTag(block, 'published') ||
      pickTag(block, 'updated') ||
      pickTag(block, 'dc:date');
    const parsed = dateRaw ? new Date(dateRaw) : null;
    const publishedAt =
      parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;

    // content:encoded 常是全文；description/summary 多为摘要
    const contentRaw =
      pickTag(block, 'content:encoded') ||
      pickTag(block, 'content') ||
      pickTag(block, 'description') ||
      pickTag(block, 'summary');

    items.push({ title, url, publishedAt, content: extractText(contentRaw) });
  }
  return items;
}
