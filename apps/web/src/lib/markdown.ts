/**
 * Web 端（服务端）Markdown 引擎。
 *
 * 此前 `api/export` 里是约 35 行的自研 mdToHtml，只认标题/代码块/图片/引用/列表/段落，
 * 且全部 escapeHtml（表格、加粗、链接、行内代码都不渲染）。本模块用 markdown-it 统一替代，
 * 并补齐 Obsidian 语法降级（处理策略与移动端 src/lib/markdown.tsx 对齐）：
 * - 预处理（需避开代码围栏）：frontmatter 剥离、callout 降级、脚注；
 * - 自定义 inline 规则：`==高亮==` → <mark>、`#标签` → chip、`[[双链]]` → 可读名。
 *   inline 规则天然不会作用于代码围栏内容，无需额外的围栏隔离逻辑。
 *
 * 暂未支持（待后续按需扩展）：LaTeX（需再引 KaTeX）、任务列表 checkbox。
 */
import MarkdownIt from 'markdown-it';

// callout 类型 → 中文标识（Obsidian 官方类型全集，与移动端 markdown.tsx 同一映射）
const CALLOUT: Record<string, string> = {
  note: '笔记', abstract: '摘要', info: '信息', todo: '待办',
  tip: '提示', success: '正确', question: '问题', warning: '警告',
  failure: '错误', danger: '危险', bug: '缺陷', example: '例题',
  quote: '引用', important: '重点', caution: '注意',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 代码围栏内的内容不参与预处理：callout/脚注正则不能改写代码示例
function transformOutsideFences(md: string, fn: (seg: string) => string): string {
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((seg) => (seg.startsWith('```') ? seg : fn(seg)))
    .join('');
}

/** frontmatter（文件开头 --- ... ---）剥离：Obsidian 元数据不进正文 */
export function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

// ---------- Obsidian 语法预处理（仅在围栏外执行） ----------
function preprocess(seg: string): string {
  return (
    seg
      // > [!warning] 标题 → 引用块内加粗「警告」标题（与移动端 obsidianFlavor 同款降级）
      .replace(/^> ?\[!(\w+)\][ \t]*(.*)$/gm, (_m, type: string, title: string) => {
        const label = CALLOUT[type.toLowerCase()] ?? type;
        return `> **「${label}」${title.trim()}**`;
      })
      // 脚注：引用处上标化、定义行转引用块（打印/卡片场景无需回跳锚点）
      .replace(/\[\^(\d+)\](?!:)/g, '^$1')
      .replace(/^\[\^(\d+)\]:[ \t]*(.+)$/gm, (_m, n: string, text: string) => `> ^${n} ${text}`)
  );
}

// ---------- 自定义 inline 规则 ----------
// state/token 用 any：@types/markdown-it 未导出 StateInline 的深路径类型，
// 而这里只需 push 一个自闭合 token（nesting=0）交给自定义 renderer 渲染，用 any 换取类型稳定。
/* eslint-disable @typescript-eslint/no-explicit-any */

// ==高亮== → <mark>（内容按纯文本处理，不嵌套解析，与观测到的笔记用法一致）
function markRule(state: any, silent: boolean): boolean {
  const start = state.pos as number;
  const src = state.src as string;
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d) return false;
  const end = src.indexOf('==', start + 2);
  if (end < 0) return false;
  const content = src.slice(start + 2, end);
  if (!content.trim()) return false;
  if (!silent) {
    const token = state.push('md_mark', '', 0);
    token.content = content;
  }
  state.pos = end + 2;
  return true;
}

// #标签 → chip（要求前导空白/括号等边界，避免吃掉 URL 的 #anchor）
function tagRule(state: any, silent: boolean): boolean {
  const start = state.pos as number;
  const src = state.src as string;
  if (src.charCodeAt(start) !== 0x23) return false;
  const prev = start > 0 ? src[start - 1] : '';
  if (prev && !/[\s(（【,，、;；]/.test(prev)) return false;
  const m = /^#([A-Za-z0-9_\u4e00-\u9fff][\w\u4e00-\u9fff/-]{0,30})/.exec(src.slice(start));
  if (!m) return false;
  state.pos = start + m[0].length;
  if (!silent) {
    const token = state.push('md_tag', '', 0);
    token.content = m[1];
  }
  return true;
}

// [[目标|别名]] → 只保留可读名（打印页/卡片无跳转上下文）
function wikilinkRule(state: any, silent: boolean): boolean {
  const start = state.pos as number;
  const src = state.src as string;
  if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
  const end = src.indexOf(']]', start + 2);
  if (end < 0) return false;
  const inner = src.slice(start + 2, end);
  if (!inner.trim() || inner.includes('\n')) return false;
  state.pos = end + 2;
  if (!silent) {
    const token = state.push('md_wikilink', '', 0);
    token.content = inner;
  }
  return true;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function createRenderer(breaks: boolean): MarkdownIt {
  // html: false —— 笔记里的原始 HTML 一律转义，避免产物 HTML（打印页）出现注入面
  const md = new MarkdownIt({ html: false, linkify: true, breaks, typographer: false });
  // 注册顺序：wikilink 必须在 link 之前（都被 '[' 触发），否则 [[x]] 会被当链接解析
  md.inline.ruler.before('link', 'md_wikilink', wikilinkRule);
  md.inline.ruler.before('link', 'md_tag', tagRule);
  md.inline.ruler.before('emphasis', 'md_mark', markRule);
  md.renderer.rules.md_mark = (tokens, idx) => `<mark>${escapeHtml(tokens[idx].content)}</mark>`;
  md.renderer.rules.md_tag = (tokens, idx) => `<span class="md-tag">#${escapeHtml(tokens[idx].content)}</span>`;
  md.renderer.rules.md_wikilink = (tokens, idx) => {
    const [target, alias] = tokens[idx].content.split('|');
    return `<span class="md-wikilink">${escapeHtml((alias ?? target).trim())}</span>`;
  };
  return md;
}

// breaks 两档各建一个单例，避免每次渲染重建实例；Obsidian 默认把单换行视作换行，故默认 true
const RENDERERS = { soft: createRenderer(false), br: createRenderer(true) };

export interface RenderOptions {
  /** 单个换行是否转 <br>，默认 true（贴合 Obsidian 默认渲染） */
  breaks?: boolean;
}

/** Obsidian Markdown → HTML（服务端：导出打印视图 / Anki 卡片背面） */
export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  const renderer = opts.breaks === false ? RENDERERS.soft : RENDERERS.br;
  return renderer.render(transformOutsideFences(stripFrontmatter(md), preprocess));
}
