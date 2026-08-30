import { StyleSheet, TextStyle, ViewStyle } from 'react-native';
import type { Palette } from '@/theme';

/**
 * Markdown 渲染共享层 —— 样式工厂 + LaTeX 轻量化预处理。
 * 知识库阅读器（reader 档）与 AI 对话气泡（chat 档）共用：
 * 全部颜色取自双主题调色板，深浅模式零闪烁切换；节点覆盖到表格/任务列表/图片，
 * 避免两处各自维护一份漂移的样式。
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
  }
> = {
  reader: {
    body: 15, lineHeight: 24,
    h1: 22, h2: 19, h3: 16, h4: 15,
    fence: 12, fenceLineHeight: 19, inline: 13,
    paraGap: 8, headingTop: 20, headingBottom: 8, listGap: 6, cellPad: 8, radius: 10, blockPad: 12,
  },
  chat: {
    body: 14, lineHeight: 22,
    h1: 17, h2: 16, h3: 15, h4: 14,
    fence: 12, fenceLineHeight: 18, inline: 12,
    paraGap: 6, headingTop: 12, headingBottom: 4, listGap: 4, cellPad: 6, radius: 8, blockPad: 10,
  },
};

/**
 * react-native-markdown-display 样式规则（v7 键体系，缺省节点回退 body）。
 * 设计要点：
 * - 标题靠字号 + 间距分层，h1 附加发丝下缘与正文区隔（文档标题感）；
 * - 行内代码 / 围栏 / 引用块用 surfaceAlt 底（深浅互换安全），行内代码用主色系提亮；
 * - 列表圆点与任务框用主色，避免灰点视觉过弱；
 * - 表格 th 深底 + 单元格细边线，移动端窄屏可读。
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

/** LaTeX 片段 → 可读 Unicode（\frac/\sqrt/希腊字母/关系符/上下标） */
export function texToText(tex: string): string {
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
