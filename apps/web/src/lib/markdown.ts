/**
 * Web 端（服务端）Markdown 引擎。
 *
 * 此前 `api/export` 里是约 35 行的自研 mdToHtml，只认标题/代码块/图片/引用/列表/段落，
 * 且全部 escapeHtml（表格、加粗、链接、行内代码都不渲染）。本模块用 markdown-it 统一替代，
 * 并补齐 Obsidian 语法（处理策略与移动端 src/lib/markdown.tsx 对齐）：
 * - 预处理（需避开代码围栏）：frontmatter / `%%注释%%` 剥离、脚注定义行降级；
 * - inline 规则：`$...$`·`$$...$$`·`\(...\)`·`\[...\]` → KaTeX(MathML)、`==高亮==` → <mark>、
 *   `#标签` → chip、`[[双链]]` → 可读名、`![[嵌入]]` → 图标降级、`[^n]` → 上标、
 *   `[!type]` → callout 标签；
 * - core 规则：GFM 任务列表 `- [ ]`/`- [x]` → 禁用态 checkbox、callout 块级类型着色；
 * - fence：自研轻量语法高亮（零依赖，配色见导出 CSS 的 .tok-*）。
 * inline/core 规则天然不会作用于代码围栏内容，无需额外的围栏隔离逻辑。
 */
import MarkdownIt from 'markdown-it';
import * as katex from 'katex';

// callout 类型 → 中文标识（Obsidian 官方类型全集，与移动端 markdown.tsx 同一映射）
const CALLOUT: Record<string, string> = {
  note: '笔记', abstract: '摘要', info: '信息', todo: '待办',
  tip: '提示', success: '正确', question: '问题', warning: '警告',
  failure: '错误', danger: '危险', bug: '缺陷', example: '例题',
  quote: '引用', important: '重点', caution: '注意',
};

// callout 图标：打印页用 emoji，零字体依赖
const CALLOUT_ICON: Record<string, string> = {
  note: '📝', abstract: '📋', info: 'ℹ️', todo: '☑️',
  tip: '💡', success: '✅', question: '❓', warning: '⚠️',
  failure: '❌', danger: '⛔', bug: '🐛', example: '🧪',
  quote: '💬', important: '🔥', caution: '⚠️',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 代码围栏内的内容不参与预处理：注释/脚注正则不能改写代码示例
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
      // %%注释%%（Obsidian 隐藏注释，可跨行）整体剔除：否则注释内容会泄漏进导出产物
      .replace(/%%[\s\S]*?%%/g, '')
      // 脚注定义行 → 引用块；引用处的 [^n] 由 inline 规则转上标（打印/卡片无需回跳锚点）
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

// 数学公式 → KaTeX。支持四种分隔符：$...$ / \(...\)（行内）、$$...$$ / \[...\]（块级，可跨行）。
// $ 与 \( 的区别在于边界规则；\( 必须在 escape 规则之前注册，否则会先被转义成 '(' 而失配。
function mathRule(state: any, silent: boolean): boolean {
  const start = state.pos as number;
  const src = state.src as string;
  const ch = src.charCodeAt(start);
  let isBlock: boolean;
  let close: string;
  if (ch === 0x24 /* $ */) {
    isBlock = src.charCodeAt(start + 1) === 0x24;
    close = isBlock ? '$$' : '$';
  } else if (ch === 0x5c /* \ */) {
    const next = src.charCodeAt(start + 1);
    if (next === 0x28 /* ( */) {
      isBlock = false;
      close = '\\)';
    } else if (next === 0x5b /* [ */) {
      isBlock = true;
      close = '\\]';
    } else return false;
  } else return false;

  const from = start + close.length; // 开合标记等长：$/$$/\(/\[
  const end = src.indexOf(close, from);
  if (end < 0) return false;
  const tex = src.slice(from, end);
  if (!tex.trim()) return false;
  // 仅 $...$ 需要边界规则：开 $ 后 / 闭 $ 前不能是空白，闭 $ 后不能紧跟数字（规避 $5、a$6 这类误判）
  if (close === '$') {
    if (/^\s/.test(tex) || /\s$/.test(tex)) return false;
    if (/\d/.test(src[end + 1] ?? '')) return false;
  }
  state.pos = end + close.length;
  if (!silent) {
    const token = state.push('md_math', '', 0);
    token.content = tex;
    token.meta = { displayMode: isBlock };
  }
  return true;
}

// [!type] → callout 彩色标签（整块的类型着色由 core 规则挂在 blockquote 上）
function calloutTagRule(state: any, silent: boolean): boolean {
  const start = state.pos as number;
  const src = state.src as string;
  if (src.charCodeAt(start) !== 0x5b /* [ */ || src.charCodeAt(start + 1) !== 0x21 /* ! */) return false;
  const m = /^\[!(\w+)\][-+]?/.exec(src.slice(start));
  if (!m) return false;
  state.pos = start + m[0].length;
  if (!silent) {
    const token = state.push('md_callout_tag', '', 0);
    token.content = m[1].toLowerCase();
  }
  return true;
}

// ![[嵌入]] → 图标 + 可读名。服务端没有仓库上下文，解析不出真实路径，
// 故降级为展示（否则 '!' 会残留在正文里，接一个 [[双链]] 渲染出的 span，很难看）。
function embedRule(state: any, silent: boolean): boolean {
  const start = state.pos as number;
  const src = state.src as string;
  if (src.charCodeAt(start) !== 0x21 /* ! */) return false;
  if (src.charCodeAt(start + 1) !== 0x5b || src.charCodeAt(start + 2) !== 0x5b) return false;
  const end = src.indexOf(']]', start + 3);
  if (end < 0) return false;
  const inner = src.slice(start + 3, end);
  if (!inner.trim() || inner.includes('\n')) return false;
  state.pos = end + 2;
  if (!silent) {
    const token = state.push('md_embed', '', 0);
    token.content = inner;
  }
  return true;
}

// [^n] → 上标（脚注定义行已在预处理阶段转成引用块）
function footnoteRule(state: any, silent: boolean): boolean {
  const start = state.pos as number;
  const src = state.src as string;
  if (src.charCodeAt(start) !== 0x5b /* [ */ || src.charCodeAt(start + 1) !== 0x5e /* ^ */) return false;
  const m = /^\[\^(\d+)\](?!:)/.exec(src.slice(start));
  if (!m) return false;
  state.pos = start + m[0].length;
  if (!silent) {
    const token = state.push('md_fn_ref', '', 0);
    token.content = m[1];
  }
  return true;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * KaTeX 渲染：output 固定 'mathml'。
 * 产物只含 MathML，浏览器原生渲染——打印 HTML / Anki 卡片因此无需引入 katex.min.css 与字体文件
 * （若用默认的 htmlAndMathml，自包含产物就得内联 20+ 个 woff2 字体，不现实）。
 * throwOnError:false 让公式写错时显示红色原文而非中断整篇导出；外层再兜一层 try/catch。
 */
function renderTex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      output: 'mathml',
      throwOnError: false,
      strict: false,
    });
  } catch {
    return `<code>${escapeHtml(displayMode ? `$$${tex}$$` : `$${tex}$`)}</code>`;
  }
}

/**
 * GFM 任务列表：`- [ ]` / `- [x]` → 禁用态 checkbox。
 * markdown-it 原生不支持，且不能引 markdown-it-task-lists——它插的是 html_inline token，
 * 在 html:false 下会被 renderer 转义成可见文本。这里改成插入自定义 token（md_checkbox）
 * 交给自己的 renderer 规则，同时把 list_item 标记为 md-task-item 以便去掉列表符号。
 * 判定条件与 GFM 对齐：list_item 的首个 paragraph.inline 以 `[ ] `/`[x] `（含空格）开头。
 */
function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'md_task_list', (state) => {
    const tokens = state.tokens as any[];
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== 'inline') continue;
      // list_item_open → paragraph_open → inline（紧凑/松散列表均为此结构）
      if (tokens[i - 1]?.type !== 'paragraph_open' || tokens[i - 2]?.type !== 'list_item_open') continue;
      const m = /^\[([ xX])\]\s+/.exec(inline.content as string);
      if (!m) continue;

      // 摘掉前缀 '[x] '（共 4 字符）：正文 content 与首个 text 子节点各一处
      inline.content = (inline.content as string).slice(4);
      const children: any[] = inline.children ?? [];
      const firstText = children.find((c) => c.type === 'text' && /^\[[ xX]\]\s/.test(c.content));
      if (firstText) firstText.content = firstText.content.slice(4);

      tokens[i - 2].attrJoin('class', 'md-task-item');
      const checkbox = new state.Token('md_checkbox', '', 0);
      checkbox.content = m[1].toLowerCase() === 'x' ? 'checked' : '';
      children.unshift(checkbox);
      inline.children = children;
    }
  });
}

/**
 * Callout 块级着色：给 `> [!type]` 所在的 blockquote 挂 `md-callout md-callout-{type}` 类。
 * 只加属性、不改 token 结构——结构手术风险高，而打印/卡片场景仅需配色与图标。
 * 判定：blockquote 内紧跟的段落 inline 以 `[!type]` 开头（与 inline 的 calloutTagRule 同源）。
 */
function calloutPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'md_callout', (state) => {
    const tokens = state.tokens as any[];
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;
      const inline = tokens[i + 2];
      if (inline?.type !== 'inline') continue;
      const m = /^\[!(\w+)\][-+]?/.exec(inline.content as string);
      if (!m) continue;
      tokens[i].attrJoin('class', `md-callout md-callout-${m[1].toLowerCase()}`);
    }
  });
}

// ---------- 代码块语法高亮（自研轻量 tokenizer，零依赖） ----------
// 语言 → 关键字族。未登记的语言不做高亮（避免拿 JS 关键字去误标 mermaid / 纯文本）。
const LANG_FAMILY: Record<string, string> = {
  py: 'python', python: 'python', py3: 'python',
  js: 'js', javascript: 'js', ts: 'js', typescript: 'js', jsx: 'js', tsx: 'js',
  java: 'js', c: 'js', cpp: 'js', go: 'js', rust: 'js',
  json: 'json',
  sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash', console: 'bash',
  sql: 'sql', mysql: 'sql', sqlite: 'sql', postgres: 'sql',
};

const KEYWORDS: Record<string, string[]> = {
  python: ['def','class','return','if','elif','else','for','while','in','not','and','or','import','from','as','with','try','except','finally','raise','lambda','pass','break','continue','None','True','False','yield','is','del','assert','async','await','print','range','len','int','str','float','list','dict','set','tuple'],
  js: ['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','class','extends','super','import','export','from','default','try','catch','finally','throw','typeof','instanceof','in','of','this','null','undefined','true','false','async','await','yield','static','delete','void','console'],
  json: ['true','false','null'],
  bash: ['echo','cd','ls','mkdir','rm','cp','mv','cat','grep','awk','sed','curl','wget','if','then','fi','else','elif','for','do','done','while','export','source','sudo','pip','npm','pnpm','git','python','python3','node','return'],
  sql: ['select','from','where','insert','into','values','update','set','delete','create','table','primary','key','foreign','references','join','left','right','inner','outer','on','group','by','order','limit','having','as','and','or','not','null','distinct','count','sum','avg','min','max','index','alter','drop','union','exists','between','like','in','case','when','then','end'],
};

/** 单行 → 带语义 class 的 HTML。class 约定：k=关键字 s=字符串 c=注释 n=数字 f=函数名（配色在导出 CSS） */
function highlightLine(line: string, family: string): string {
  const kws = KEYWORDS[family] ?? KEYWORDS.js;
  const sqlCi = family === 'sql'; // SQL 关键字大小写不敏感
  const commentRe = family === 'python' || family === 'bash' ? '#[^\\n]*' : '//[^\\n]*';
  const re = new RegExp(
    `(${commentRe})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_$][\\w$]*)`,
    'g'
  );
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    out += escapeHtml(line.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) out += `<span class="tok-c">${escapeHtml(m[0])}</span>`;
    else if (m[2]) out += `<span class="tok-s">${escapeHtml(m[0])}</span>`;
    else if (m[3]) out += `<span class="tok-n">${escapeHtml(m[0])}</span>`;
    else {
      const word = m[4];
      const isKw = sqlCi ? kws.includes(word.toLowerCase()) : kws.includes(word);
      // 函数名：紧跟着（可跨空格的）左括号
      if (isKw) out += `<span class="tok-k">${escapeHtml(word)}</span>`;
      else if (line[last] === '(' || /^\s*\(/.test(line.slice(last)))
        out += `<span class="tok-f">${escapeHtml(word)}</span>`;
      else out += escapeHtml(word);
    }
  }
  out += escapeHtml(line.slice(last));
  return out;
}

/** fence 渲染：登记过的语言走高亮，其余只转义（不猜语言） */
function renderFence(code: string, lang: string): string {
  const family = LANG_FAMILY[lang.toLowerCase()];
  const body = code.replace(/\n$/, '');
  const html = family ? body.split('\n').map((l) => highlightLine(l, family)).join('\n') : escapeHtml(body);
  const label = lang ? `<div class="md-code-lang">${escapeHtml(lang)}</div>` : '';
  return `<pre class="md-code">${label}<code>${html}</code></pre>\n`;
}

// ---------- 标题锚点（供 PDF 目录跳转与书签使用） ----------
/**
 * 标题 → id：只保留中英文数字下划线，其余（空格、标点、markdown 标记）压成连字符。
 * 中文直接留在 id 里（HTML5 允许），比转拼音/编码更可读，也便于 TOC 的 href 对齐。
 */
function slugify(text: string): string {
  return text
    .trim()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** 同篇内重复标题追加序号：渲染与 extractHeadings 必须用同一套顺序，否则锚点对不上 */
function uniqueSlug(base: string, seen: Map<string, number>): string {
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

export interface HeadingItem {
  level: number;
  text: string;
  id: string;
}

/**
 * 提取标题结构（供 PDF 目录）。
 * 判定与 renderer 的 heading_open 规则严格一致——同样只扫围栏外内容、同样的 slug 与去重顺序，
 * 因此生成的 id 能精确对上正文锚点。
 */
export function extractHeadings(md: string, maxLevel = 3): HeadingItem[] {
  const seen = new Map<string, number>();
  const out: HeadingItem[] = [];
  transformOutsideFences(stripFrontmatter(md), (seg) => {
    // 必须与 renderMarkdown 走同一套预处理：注释剥离会决定标题行是否存续，漏掉就会产出死锚点
    for (const m of preprocess(seg).matchAll(/^(#{1,6})\s+(.+)$/gm)) {
      const level = m[1].length;
      if (level > maxLevel) continue;
      const text = m[2].trim();
      const base = slugify(text);
      if (!base) continue;
      out.push({ level, text, id: uniqueSlug(base, seen) });
    }
    return seg;
  });
  return out;
}

function createRenderer(breaks: boolean): MarkdownIt {
  // html: false —— 笔记里的原始 HTML 一律转义，避免产物 HTML（打印页）出现注入面
  const md = new MarkdownIt({ html: false, linkify: true, breaks, typographer: false });
  // 注册顺序：wikilink/embed/tag/callout/footnote 都以 '[' 或 '!' 触发，必须排在 link/image 之前，
  // 否则会被当成链接或图片解析
  md.inline.ruler.before('link', 'md_wikilink', wikilinkRule);
  md.inline.ruler.before('link', 'md_tag', tagRule);
  md.inline.ruler.before('link', 'md_callout_tag', calloutTagRule);
  md.inline.ruler.before('link', 'md_fn_ref', footnoteRule);
  md.inline.ruler.before('image', 'md_embed', embedRule);
  md.inline.ruler.before('emphasis', 'md_mark', markRule);
  // math 必须排在 escape 之前：\(...\) 的 \( 会被 escape 规则转义成 '(' 而失配
  md.inline.ruler.before('escape', 'md_math', mathRule);
  md.renderer.rules.md_mark = (tokens, idx) => `<mark>${escapeHtml(tokens[idx].content)}</mark>`;
  md.renderer.rules.md_tag = (tokens, idx) => `<span class="md-tag">#${escapeHtml(tokens[idx].content)}</span>`;
  md.renderer.rules.md_wikilink = (tokens, idx) => {
    const [target, alias] = tokens[idx].content.split('|');
    return `<span class="md-wikilink">${escapeHtml((alias ?? target).trim())}</span>`;
  };
  md.renderer.rules.md_callout_tag = (tokens, idx) => {
    const type = tokens[idx].content;
    return `<span class="md-callout-tag">${CALLOUT_ICON[type] ?? '📌'} ${escapeHtml(CALLOUT[type] ?? type)}</span>`;
  };
  md.renderer.rules.md_fn_ref = (tokens, idx) => `<sup class="md-fn-ref">${escapeHtml(tokens[idx].content)}</sup>`;
  md.renderer.rules.md_embed = (tokens, idx) => {
    // ![[目标|别名]]：别名位若是 300 / 300x200 这类尺寸，展示名回退到文件名
    const [targetRaw, aliasRaw] = tokens[idx].content.split('|');
    const target = targetRaw.trim();
    const alias = (aliasRaw ?? '').trim();
    const name = alias && !/^\d+(x\d+)?$/.test(alias) ? alias : target;
    const icon = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(target) ? '🖼' : '📄';
    return `<span class="md-embed">${icon} ${escapeHtml(name)}</span>`;
  };
  md.renderer.rules.md_math = (tokens, idx) => {
    const meta = tokens[idx].meta as { displayMode?: boolean } | undefined;
    return renderTex(tokens[idx].content, Boolean(meta?.displayMode));
  };
  md.renderer.rules.md_checkbox = (tokens, idx) =>
    `<input type="checkbox" disabled${tokens[idx].content ? ' checked' : ''}> `;
  // 代码块：接管 fence，输出带语言标签与语义 class 的高亮 HTML
  md.renderer.rules.fence = (tokens, idx) => {
    const info = (tokens[idx].info || '').trim().split(/\s+/)[0] ?? '';
    return renderFence(tokens[idx].content, info);
  };
  // 标题锚点：id 记在 env 上（每次 render 传入全新 env），同篇内去重、跨篇不串号
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const inline = tokens[idx + 1];
    const base = slugify(inline?.type === 'inline' ? inline.content : '');
    if (base) {
      const store = env as { __headingIds?: Map<string, number> };
      const seen = (store.__headingIds ??= new Map<string, number>());
      tokens[idx].attrSet('id', uniqueSlug(base, seen));
    }
    return self.renderToken(tokens, idx, options);
  };
  taskListPlugin(md);
  calloutPlugin(md);
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
  try {
    return renderer.render(transformOutsideFences(stripFrontmatter(md), preprocess));
  } catch {
    // 引擎内部异常（畸形输入）不能让整篇导出失败：降级为转义后的纯文本
    return `<pre>${escapeHtml(md)}</pre>`;
  }
}
