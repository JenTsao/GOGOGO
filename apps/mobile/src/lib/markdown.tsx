import { memo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, TextStyle, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { HIT_SLOP, type Palette } from '@/theme';

/**
 * Markdown 渲染共享层 —— 样式工厂 + 渲染规则 + 预处理（LaTeX / Obsidian 风格）。
 * 知识库阅读器（reader 档）与 AI 对话气泡（chat 档）共用：
 * - markdownTheme：双尺度排版（reader 宽节奏 / chat 紧凑）；
 * - markdownRules：fence 语法高亮 + 复制 + 长块折叠，table 横向滚动；
 * - 预处理：$$/$ LaTeX 轻量化、Obsidian callout/高亮/标签/脚注、AI <think> 剥离。
 */

export type MarkdownScale = 'reader' | 'chat';

/** 双尺度排版参数：reader 阅读场景放宽节奏，chat 对话场景紧凑不挤占气泡 */
const SCALES: Record<
  MarkdownScale,
  {
    body: number;
    lineHeight: number;
    h1: number;
    h2: number;
    h3: number;
    h4: number;
    fence: number;
    fenceLineHeight: number;
    inline: number;
    paraGap: number;
    headingTop: number;
    headingBottom: number;
    listGap: number;
    cellPad: number;
    radius: number;
    blockPad: number;
    /** 超过该行数视为长代码块，先折叠 */
    foldLines: number;
  }
> = {
  reader: {
    body: 15, lineHeight: 24,
    h1: 22, h2: 19, h3: 16, h4: 15,
    fence: 12, fenceLineHeight: 19, inline: 13,
    paraGap: 8, headingTop: 20, headingBottom: 8, listGap: 6, cellPad: 8, radius: 10, blockPad: 12,
    foldLines: 18,
  },
  chat: {
    body: 14, lineHeight: 22,
    h1: 17, h2: 16, h3: 15, h4: 14,
    fence: 12, fenceLineHeight: 18, inline: 12,
    paraGap: 6, headingTop: 12, headingBottom: 4, listGap: 4, cellPad: 6, radius: 8, blockPad: 10,
    foldLines: 12,
  },
};

/**
 * react-native-markdown-display 样式规则（v7 键体系，缺省节点回退 body）。
 * 设计要点：
 * - 标题靠字号 + 间距分层，h1 附加发丝下缘与正文区隔（文档标题感）；
 * - 行内代码 / 引用块用 surfaceAlt 底（深浅互换安全），行内代码用主色系提亮；
 * - 列表圆点与任务框用主色，避免灰点视觉过弱；
 * - 表格 th 深底 + 单元格细边线（fence/table 的自定义渲染见 markdownRules）。
 */
export function markdownTheme(c: Palette, scale: MarkdownScale): Record<string, TextStyle | ViewStyle> {
  const s = SCALES[scale];
  const heading = (size: number, extra?: TextStyle): TextStyle => ({
    fontSize: size,
    lineHeight: Math.round(size * 1.35),
    fontWeight: '700',
    color: c.text,
    marginTop: s.headingTop,
    marginBottom: s.headingBottom,
    ...extra,
  });
  return {
    body: { color: c.text, fontSize: s.body, lineHeight: s.lineHeight, letterSpacing: 0.1 },
    paragraph: { marginTop: 0, marginBottom: s.paraGap },
    strong: { fontWeight: '700', color: c.text },
    em: { fontStyle: 'italic', color: c.text },
    s: { color: c.text3 },
    link: { color: c.primary, fontWeight: '500' },
    heading1: heading(s.h1, {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      paddingBottom: 6,
    }),
    heading2: heading(s.h2),
    heading3: heading(s.h3),
    heading4: heading(s.h4),
    heading5: heading(s.h4),
    heading6: heading(s.h4),
    code_inline: {
      fontFamily: 'monospace',
      fontSize: s.inline,
      backgroundColor: c.primarySoft,
      color: c.primaryDeep,
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    fence: {
      fontFamily: 'monospace',
      fontSize: s.fence,
      lineHeight: s.fenceLineHeight,
      backgroundColor: c.surfaceAlt,
      color: c.text,
      borderRadius: s.radius,
      padding: s.blockPad,
      marginBottom: s.paraGap,
    },
    blockquote: {
      backgroundColor: c.surfaceAlt,
      borderLeftWidth: 3,
      borderLeftColor: c.primary,
      borderRadius: s.radius,
      paddingVertical: 6,
      paddingHorizontal: s.blockPad,
      marginBottom: s.paraGap,
    },
    bullet_list: { marginBottom: s.paraGap },
    ordered_list: { marginBottom: s.paraGap },
    list_item: { marginBottom: s.listGap },
    bullet_list_icon: { color: c.primary, lineHeight: s.lineHeight },
    ordered_list_icon: { color: c.primary, lineHeight: s.lineHeight },
    th: {
      padding: s.cellPad,
      backgroundColor: c.surfaceAlt,
      fontWeight: '700',
      color: c.text,
      borderWidth: 1,
      borderColor: c.border,
      fontSize: s.body - 1,
      lineHeight: s.lineHeight - 2,
    },
    td: {
      padding: s.cellPad,
      color: c.text,
      borderWidth: 1,
      borderColor: c.border,
      fontSize: s.body - 1,
      lineHeight: s.lineHeight - 2,
    },
    taskList: { marginBottom: s.paraGap },
    taskListItem: { flexDirection: 'row', alignItems: 'center', marginBottom: s.listGap },
    taskListCheckbox: { color: c.primary },
    image: { borderRadius: s.radius, marginBottom: s.paraGap },
    hr: { backgroundColor: c.border, height: 1, marginVertical: s.headingTop },
  };
}

// ---------- 代码语法高亮（轻量 tokenizer，覆盖学生场景高频语言） ----------

type Tok = { t: string; c?: string; i?: boolean };

const KEYWORDS: Record<string, string[]> = {
  python: ['def','class','return','if','elif','else','for','while','in','not','and','or','import','from','as','with','try','except','finally','raise','lambda','pass','break','continue','None','True','False','yield','is','del','assert','async','await','print','range','len','int','str','float','list','dict','set','tuple'],
  js: ['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','class','extends','super','import','export','from','default','try','catch','finally','throw','typeof','instanceof','in','of','this','null','undefined','true','false','async','await','yield','static','delete','void','console'],
  json: ['true','false','null'],
  bash: ['echo','cd','ls','mkdir','rm','cp','mv','cat','grep','awk','sed','curl','wget','if','then','fi','else','elif','for','do','done','while','export','source','sudo','pip','npm','pnpm','git','python','python3','node','return'],
  sql: ['select','from','where','insert','into','values','update','set','delete','create','table','primary','key','foreign','references','join','left','right','inner','outer','on','group','by','order','limit','having','as','and','or','not','null','distinct','count','sum','avg','min','max','index','alter','drop','union','exists','between','like','in','case','when','then','end'],
};

function familyOf(lang: string): keyof typeof KEYWORDS {
  const l = lang.toLowerCase();
  if (/^(py|python|py3)$/.test(l)) return 'python';
  if (/^(json)$/.test(l)) return 'json';
  if (/^(sh|bash|zsh|shell|console)$/.test(l)) return 'bash';
  if (/^(sql|mysql|sqlite|postgres)$/.test(l)) return 'sql';
  // js/ts/jsx/tsx/其余未识别语言都按 C 系关键字兜底（覆盖面最大）
  return 'js';
}

/** 单行 tokenize：注释 / 字符串 / 数字 / 关键字 / 函数调用（后跟括号）/ 标识符 */
function tokenizeLine(line: string, lang: string, c: Palette): Tok[] {
  const family = familyOf(lang);
  const kws = KEYWORDS[family];
  const sqlCi = family === 'sql'; // SQL 关键字大小写不敏感
  // 注释风格：python/bash 用 #，其余用 //
  const commentRe = family === 'python' || family === 'bash' ? '#[^\\n]*' : '//[^\\n]*';
  const re = new RegExp(
    `(${commentRe})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_$][\\w$]*)`,
    'g'
  );
  const toks: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const pushPlain = (t: string) => t && toks.push({ t });
  while ((m = re.exec(line))) {
    pushPlain(line.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) toks.push({ t: m[0], c: c.text3, i: true }); // 注释
    else if (m[2]) toks.push({ t: m[0], c: c.green }); // 字符串
    else if (m[3]) toks.push({ t: m[0], c: c.orange }); // 数字
    else {
      const w = m[4];
      const isKw = sqlCi ? kws.includes(w.toLowerCase()) : kws.includes(w);
      if (isKw) toks.push({ t: w, c: c.primary, i: family === 'sql' }); // 关键字
      else if (line[last] === '(' || (line[last] === ' ' && line.slice(last).match(/^\s*\(/)))
        toks.push({ t: w, c: c.blue }); // 函数名：后跟（可跨空格的）左括号
      else toks.push({ t: w });
    }
  }
  pushPlain(line.slice(last));
  return toks;
}

/** 代码围栏渲染器：语言标签 + 逐行高亮 + 一键复制 + 长块折叠 */
const FenceCode = memo(function FenceCode({
  code,
  lang,
  c,
  scale,
}: {
  code: string;
  lang: string;
  c: Palette;
  scale: MarkdownScale;
}) {
  const s = SCALES[scale];
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lines = code.replace(/\n$/, '').split('\n');
  const foldable = lines.length > s.foldLines + 2;
  const shown = !expanded && foldable ? lines.slice(0, s.foldLines) : lines;

  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 复制失败静默（老 ROM 剪贴板偶发不可用）
    }
  };

  return (
    <View
      style={{
        backgroundColor: c.surfaceAlt,
        borderRadius: s.radius,
        padding: s.blockPad,
        marginBottom: s.paraGap,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <View
          style={{
            backgroundColor: c.primarySoft,
            borderRadius: 4,
            paddingHorizontal: 6,
            paddingVertical: 1,
          }}
        >
          <Text style={{ fontSize: 10, fontFamily: 'monospace', color: c.primaryDeep, fontWeight: '600' }}>
            {(lang || 'text').toLowerCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={onCopy}
          hitSlop={HIT_SLOP}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
          accessibilityLabel="复制代码"
        >
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={12} color={copied ? c.green : c.text3} />
          <Text style={{ fontSize: 10, color: copied ? c.green : c.text3 }}>{copied ? '已复制' : '复制'}</Text>
        </TouchableOpacity>
      </View>
      {shown.map((line, i) => {
        const toks = tokenizeLine(line, lang, c);
        return (
          <Text
            key={i}
            style={{ fontFamily: 'monospace', fontSize: s.fence, lineHeight: s.fenceLineHeight, color: c.text }}
          >
            {toks.map((t, j) => (
              <Text key={j} style={t.c ? { color: t.c, fontStyle: t.i ? 'italic' : 'normal' } : undefined}>
                {t.t}
              </Text>
            ))}
            {i < shown.length - 1 ? '\n' : ''}
          </Text>
        );
      })}
      {foldable && (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          hitSlop={HIT_SLOP}
          activeOpacity={0.7}
          style={{ marginTop: 6, alignSelf: 'flex-start' }}
          accessibilityLabel={expanded ? '收起代码' : '展开全部代码'}
        >
          <Text style={{ fontSize: 11, color: c.primary, fontWeight: '600' }}>
            {expanded ? '收起' : `展开全部 ${lines.length} 行`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
});

/**
 * markdown-display 自定义渲染规则（与默认规则浅合并）：
 * - fence：语言标签 + 高亮 + 复制 + 折叠（node.source=代码、node.settings=语言，v7 AST 字段）；
 * - table：宽表横向滚动（默认实现会溢出裁切）。
 * 返回类型靠推断：少参函数可赋给 RenderRules 的四参签名。
 */
export function markdownRules(c: Palette, scale: MarkdownScale) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fence: (node: any) => (
      <FenceCode
        code={String(node?.source ?? '')}
        lang={String(node?.settings ?? '')}
        c={c}
        scale={scale}
      />
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: (_node: any, children: ReactNode) => (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SCALES[scale].paraGap }}>
        <View>{children}</View>
      </ScrollView>
    ),
  };
}

// ---------- LaTeX 轻量化（高考数学高频场景，Expo 下无 KaTeX 的 Unicode 近似） ----------

// 上下标 Unicode 映射
const SUPER: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', 'n': 'ⁿ', 'i': 'ⁱ', 'k': 'ᵏ',
};
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'n': 'ₙ',
};
const toSup = (s: string) => [...s].map((ch) => SUPER[ch] ?? `^${ch}`).join('');
const toSub = (s: string) => [...s].map((ch) => SUB[ch] ?? `_${ch}`).join('');

/** LaTeX 片段 → 可读 Unicode（\frac/\sqrt/矩阵/向量/希腊字母/关系符/上下标） */
export function texToText(tex: string): string {
  let s = tex;
  const map: [RegExp, string | ((m: string, a: string, b: string) => string)][] = [
    // 布尔/排版噪声先剥（避免后续规则匹配残留）
    [/\\displaystyle|\\limits|\\left\.|\\right\./g, ''],
    [/\\(?:dfrac|tfrac)\{([^{}]+)\}\{([^{}]+)\}/g, (_m, a, b) => `(${a})/(${b})`],
    [/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_m, a, b) => `(${a})/(${b})`],
    [/\\binom\{([^{}]+)\}\{([^{}]+)\}/g, (_m, a, b) => `C(${a},${b})`],
    [/\\sqrt\{([^{}]+)\}/g, (_m, a) => `√(${a})`],
    // 矩阵/行列式：剥环境，& 分列、\\ 分行
    [/\\begin\{(?:p?matrix|bmatrix|vmatrix|cases)\}([\s\S]*?)\\end\{(?:p?matrix|bmatrix|vmatrix|cases)\}/g,
      (_m, body: string) => `(${String(body).replace(/\\\\|\\cr/g, '; ').replace(/&/g, ' ').trim()})`],
    // 重音符号（组合字符）
    [/\\vec\{([^{}]+)\}/g, (_m, a) => `${a}\u20D7`],
    [/\\(?:hat|widehat)\{([^{}]+)\}/g, (_m, a) => `${a}\u0302`],
    [/\\bar\{([^{}]+)\}/g, (_m, a) => `${a}\u0304`],
    [/\\dot\{([^{}]+)\}/g, (_m, a) => `${a}\u0307`],
    [/\\tilde\{([^{}]+)\}/g, (_m, a) => `${a}\u0303`],
    // 文本包裹
    [/\\(?:text|mathrm|mathbf|mathit)\{([^{}]*)\}/g, '$1'],
    // 特殊符号族
    [/\\(?:geqslant|geq(?:s)?)|\\ge\b/g, '≥'], [/\\(?:leqslant|leq(?:s)?)|\\le\b/g, '≤'],
    [/\\neq|\\ne\b/g, '≠'], [/\\approx/g, '≈'], [/\\equiv/g, '≡'], [/\\sim\b/g, '∼'], [/\\propto/g, '∝'],
    [/\\times/g, '×'], [/\\cdot/g, '·'], [/\\pm/g, '±'], [/\\mp/g, '∓'],
    [/\\infty/g, '∞'], [/\\sum/g, 'Σ'], [/\\prod/g, 'Π'], [/\\int/g, '∫'],
    [/\\partial/g, '∂'], [/\\nabla/g, '∇'], [/\\angle/g, '∠'], [/\\triangle/g, '△'],
    [/\\parallel/g, '∥'], [/\\perp/g, '⊥'], [/\\because/g, '∵'], [/\\therefore/g, '∴'],
    [/\\circ|\\degree/g, '°'], [/\\prime/g, '′'],
    [/\\(?:c|l)dots|\\dots/g, '…'],
    [/\\lfloor/g, '⌊'], [/\\rfloor/g, '⌋'], [/\\lceil/g, '⌈'], [/\\rceil/g, '⌉'],
    [/\\(?:varnothing|emptyset)/g, '∅'],
    [/\\mathbb\{R\}/g, 'ℝ'], [/\\mathbb\{Z\}/g, 'ℤ'], [/\\mathbb\{N\}/g, 'ℕ'], [/\\mathbb\{Q\}/g, 'ℚ'], [/\\mathbb\{C\}/g, 'ℂ'],
    // 希腊字母
    [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'], [/\\delta/g, 'δ'], [/\\epsilon|\\varepsilon/g, 'ε'],
    [/\\theta/g, 'θ'], [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'], [/\\pi/g, 'π'], [/\\rho/g, 'ρ'],
    [/\\sigma/g, 'σ'], [/\\tau/g, 'τ'], [/\\varphi|\\phi/g, 'φ'], [/\\omega/g, 'ω'],
    [/\\Delta/g, 'Δ'], [/\\Omega/g, 'Ω'], [/\\Sigma/g, 'Σ'], [/\\Lambda/g, 'Λ'], [/\\Gamma/g, 'Γ'],
    // 关系与集合（subseteq 必须在 subset 之前，否则前缀被吃掉剩 eq）
    [/\\in\b/g, '∈'], [/\\notin/g, '∉'], [/\\subseteq/g, '⊆'], [/\\supseteq/g, '⊇'], [/\\supset/g, '⊃'], [/\\subset/g, '⊂'],
    [/\\cup/g, '∪'], [/\\cap/g, '∩'], [/\\forall/g, '∀'], [/\\exists/g, '∃'],
    [/\\mapsto/g, '↦'], [/\\rightarrow|\\to\b/g, '→'], [/\\Rightarrow/g, '⇒'], [/\\leftrightarrow/g, '↔'], [/\\Leftrightarrow/g, '⇔'],
    // 间距命令
    [/\\(?:quad|qquad)\b/g, '  '], [/\\[,;]\s*/g, ' '], [/\\!\s*/g, ''],
    [/\\left\|/g, '|'], [/\\right\|/g, '|'], [/\\(?:left|right)\b/g, ''],
    // 函数名
    [/\\lim/g, 'lim'], [/\\log/g, 'log'], [/\\ln/g, 'ln'], [/\\sin/g, 'sin'], [/\\cos/g, 'cos'], [/\\tan/g, 'tan'],
  ];
  for (const [re, rep] of map) s = s.replace(re, rep as string);
  s = s.replace(/\^\{([^{}]+)\}|\^(\w)/g, (_m, g1, g2) => toSup(g1 ?? g2));
  s = s.replace(/_\{([^{}]+)\}|_(\w)/g, (_m, g1, g2) => toSub(g1 ?? g2));
  return s.replace(/[{}]/g, '').trim();
}

/** 代码围栏内的内容不转换（数学/双链替换只作用于正文段落） */
export function transformOutsideFences(md: string, fn: (seg: string) => string): string {
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((seg) => (seg.startsWith('```') ? seg : fn(seg)))
    .join('');
}

/** 块级 $$...$$ 转独立加粗行，行内 $...$ 原位内联转写 */
export function mathLite(md: string): string {
  return md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => `\n\n**${texToText(tex)}**\n\n`)
    .replace(/\$([^$\n]+?)\$/g, (_m, tex) => texToText(tex));
}

// ---------- Obsidian 风格语法（callout / 高亮 / 标签 / 脚注） ----------

// callout 类型 → 中文标识（ Obsidian 官方类型全集）
const CALLOUT: Record<string, string> = {
  note: '笔记', abstract: '摘要', info: '信息', todo: '待办',
  tip: '提示', success: '正确', question: '问题', warning: '警告',
  failure: '错误', danger: '危险', bug: '缺陷', example: '例题',
  quote: '引用', important: '重点', caution: '注意',
};

/**
 * Obsidian 特有语法降级为标准 Markdown（在 mathLite 之前跑，均在围栏外）：
 * - ==高亮== → 行内代码 chip（primarySoft 底近似高亮观感）；
 * - #标签 → 行内代码 chip（需前导空白/括号，行首 #+空格 的标题不受影响）；
 * - > [!type] 标题 → 引用块内加粗「类型」标题行；
 * - 脚注引用 [^n] → 上标；脚注定义行 → 引用块。
 */
export function obsidianFlavor(seg: string): string {
  return seg
    .replace(/==([^=\n]+)==/g, (_m, x: string) => '`' + x + '`')
    .replace(/(^|[\s(（【,，、;；])#([A-Za-z0-9_\u4e00-\u9fff][\w\u4e00-\u9fff/-]{0,30})/g, (_m, pre: string, tag: string) => `${pre}\`#${tag}\``)
    .replace(/^> ?\[!(\w+)\][ \t]*(.*)$/gm, (_m, type: string, title: string) => {
      const label = CALLOUT[type.toLowerCase()] ?? type;
      return `> **「${label}」${title.trim()}**`;
    })
    .replace(/\[\^(\d+)\](?!:)/g, (_m, n: string) => toSup(n))
    .replace(/^\[\^(\d+)\]:[ \t]*(.+)$/gm, (_m, n: string, text: string) => `> ${toSup(n)} ${text}`);
}

/** 知识库正文预处理：Obsidian 风格 → LaTeX 轻量化（围栏外，frontmatter/双链由调用方处理） */
export const noteFlavor = (seg: string): string => mathLite(obsidianFlavor(seg));

/** AI 对话预处理：剥 <think> 推理段（DeepSeek R1 等推理模型）→ 同 noteFlavor */
export function chatPreprocess(md: string): string {
  const stripped = md.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return transformOutsideFences(stripped, noteFlavor);
}
