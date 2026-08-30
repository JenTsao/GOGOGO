import { StyleSheet, TextStyle, ViewStyle, useColorScheme } from 'react-native';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * 全 App 设计令牌 —— 所有页面统一从这里取色 / 圆角 / 阴影，禁止散落硬编码 hex。
 * 风格：教育场景柔和卡片风 + 液态玻璃（真模糊 expo-blur + 半透面 + 顶缘受光描边）。
 * 深浅双调色板：深色为紫调深底（不取纯黑，保留品牌色相），深浅两套键完全对齐；
 * 正文对比度 ≥ 4.5:1，次要文字 ≥ 3:1（两套均按 WCAG AA 校验）。
 */

// 主题模式：system 跟随系统，light/dark 手动固定（settingsStore.themeMode 持久化）
export type Scheme = 'light' | 'dark';
export type ThemeMode = 'system' | Scheme;

// ---------- 浅色基线（教育紫） ----------
const light = {
  // 表面
  bg: '#F6F4FA', // 页面底色（淡紫灰）
  card: '#FFFFFF',
  surfaceAlt: '#EBE7F4', // 次级表面：分段控件轨道 / 进度条底 / 禁用底
  // 主色（教育紫）
  primary: '#7C3AED',
  primaryDeep: '#6D28D9',
  primarySoft: '#F1EAFC', // 主色浅底：选中态 / 用户气泡
  onPrimary: '#FFFFFF', // 主色之上的内容（按钮文字/图标/加载圈）
  // 文字
  text: '#211D33',
  text2: '#6A647F',
  text3: '#9B95AE',
  // 线
  border: '#E9E4F3',
  // 语义色（soft 为对应浅底，deep 为 soft 底上的文字——对比度均 ≥ 4.5:1）
  green: '#0F9D6E',
  greenSoft: '#E8F7F0',
  greenDeep: '#0B6B4A',
  orange: '#D97706',
  orangeSoft: '#FDF3E3',
  amberDeep: '#7A5A10', // orangeSoft 底上的警示正文
  warnDeep: '#6B5414', // 暖黄提示底上的文字
  red: '#DC2626',
  redSoft: '#FDECEC',
  roseDeep: '#B04A4A', // redSoft 底上的文字
  blue: '#2563EB',
  blueSoft: '#EAF1FE',
  // 心流沉浸场景（黑底专属场景色，双模式同值——心流恒为深色）
  ink: '#0D0B14',
  inkBorder: '#2A2440',
  inkBorderStrong: '#3A3355',
  inkText: '#9D93BD',
  inkSub: '#8B7FC7',
  inkDim: '#AAA6B5',
  // 代码沙盒控制台（双模式同值：代码语境恒为深底）
  consoleBg: '#241F3A',
  consoleText: '#C7E8D5',
  consoleDim: '#6A6489',
  // 液态玻璃（Liquid Glass）：真模糊由 expo-blur 承担，这里只管颜色与描边
  // 面略透，让 BlurView 透出下层；Strong 用于正文面板，保证可读
  glassSurface: 'rgba(255,255,255,0.52)',
  glassSurfaceStrong: 'rgba(255,255,255,0.72)',
  // 玻璃卡：浅色下半透（透出环境光斑产生折射层次）；深色下实底（可读优先，玻璃感靠描边高光）
  glassCard: 'rgba(255,255,255,0.74)',
  glassDark: 'rgba(255,255,255,0.10)',
  glassBorder: 'rgba(255,255,255,0.55)', // 侧缘
  glassBorderSoft: 'rgba(255,255,255,0.22)',
  glassDarkBorder: 'rgba(255,255,255,0.18)',
  // 顶缘受光高光（模拟玻璃折射）
  glassHighlight: 'rgba(255,255,255,0.88)',
  glassHighlightSoft: 'rgba(255,255,255,0.45)',
  // 环境光斑（AmbientGlow 绝对定位大圆）：给半透玻璃「透」出色彩层次
  glowPrimary: 'rgba(124,58,237,0.10)',
  glowBlue: 'rgba(37,99,235,0.07)',
  glowGreen: 'rgba(15,157,110,0.06)',
  // 遮罩（Modal 背后压暗，略偏紫以贴合品牌）
  glassDim: 'rgba(18,14,34,0.42)',
};

// ---------- 深色（紫调深底，OLED 友好不取纯黑） ----------
const dark: typeof light = {
  bg: '#14121E',
  card: '#1E1B2E',
  surfaceAlt: '#2A2740',
  // 主色提亮为 violet-400：深底上作文字/图标对比 ≥ 5:1
  primary: '#A78BFA',
  primaryDeep: '#8B5CF6',
  primarySoft: 'rgba(167,139,250,0.16)',
  onPrimary: '#1B1730', // 亮紫按钮上的深色内容（对比 ≥ 7:1）
  text: '#ECE9FA',
  text2: '#A9A3C4',
  text3: '#837CA8',
  border: '#2C2942',
  green: '#34D399',
  greenSoft: 'rgba(52,211,153,0.14)',
  greenDeep: '#6EE7B7',
  orange: '#F59E0B',
  orangeSoft: 'rgba(217,119,6,0.16)',
  amberDeep: '#FBBF24',
  warnDeep: '#FDE68A',
  red: '#F87171',
  redSoft: 'rgba(248,113,113,0.14)',
  roseDeep: '#FCA5A5',
  blue: '#60A5FA',
  blueSoft: 'rgba(96,165,250,0.14)',
  // 心流/控制台：恒为深色场景，双模式同值
  ink: '#0D0B14',
  inkBorder: '#2A2440',
  inkBorderStrong: '#3A3355',
  inkText: '#9D93BD',
  inkSub: '#8B7FC7',
  inkDim: '#AAA6B5',
  consoleBg: '#241F3A',
  consoleText: '#C7E8D5',
  consoleDim: '#6A6489',
  // 深色玻璃：低透白面 + 弱受光描边（AI 面板承载正文用近实底保证可读）
  glassSurface: 'rgba(36,32,56,0.55)',
  glassSurfaceStrong: 'rgba(30,27,46,0.82)',
  // 深色下玻璃卡取实底：7% 白透光斑在深底上噪声大于收益，可读优先；玻璃感靠 rim 顶光
  glassCard: '#1E1B2E',
  glassDark: 'rgba(255,255,255,0.08)',
  glassBorder: 'rgba(255,255,255,0.16)',
  glassBorderSoft: 'rgba(255,255,255,0.08)',
  glassDarkBorder: 'rgba(255,255,255,0.18)',
  glassHighlight: 'rgba(255,255,255,0.28)',
  glassHighlightSoft: 'rgba(255,255,255,0.12)',
  // 深色光斑：亮紫/亮蓝低透明，深底上透出微光
  glowPrimary: 'rgba(167,139,250,0.10)',
  glowBlue: 'rgba(96,165,250,0.07)',
  glowGreen: 'rgba(52,211,153,0.06)',
  glassDim: 'rgba(8,6,16,0.55)',
};

export type Palette = typeof light;
export const palettes: Record<Scheme, Palette> = { light, dark };

// 专注热力阶梯（近端深、远端浅；深色模式下 0 值格换深底避免亮块误导）
export const HEAT_SCALE = ['#EEEBF4', '#D5EBDD', '#9CD3AA', '#4E9A5F', '#1C5D2C'] as const;
export const HEAT_SCALE_DARK = ['#2A2740', '#1F4A38', '#2E7D4F', '#4E9A5F', '#7BC98A'] as const;

/** 统一卡片阴影（iOS shadow + Android elevation 双兜底；深色模式靠表面色差分层，阴影不变） */
export const cardShadow: ViewStyle = StyleSheet.create({
  shadow: {
    shadowColor: '#3B2D6B',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
}).shadow;

/**
 * 液态玻璃双边：顶缘高光 + 侧/底弱描边，模拟折射与厚度。
 * 用于无 BlurView 的玻璃卡（滚动列表内，避免每卡开一层模糊）。
 */
export const glassRim = (c: Palette): ViewStyle => ({
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: c.glassBorder,
  borderTopColor: c.glassHighlight,
  borderBottomColor: c.glassBorderSoft,
});

/** 玻璃面板液态柔影（比卡片阴影更深更散，模拟玻璃悬浮） */
export const glassShadow: ViewStyle = StyleSheet.create({
  shadow: {
    shadowColor: '#2A1E5C',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
}).shadow;

/** 深色场景略加重的玻璃阴影 */
export const glassShadowDark: ViewStyle = StyleSheet.create({
  shadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
}).shadow;

export const glassShadowFor = (scheme: Scheme): ViewStyle =>
  scheme === 'dark' ? glassShadowDark : glassShadow;

/** Tab / Sheet 模糊强度（iOS 与 Android dimezis 观感接近的经验值） */
export const GLASS_BLUR = {
  tab: { light: 48, dark: 64 },
  sheet: { light: 60, dark: 78 },
  card: { light: 36, dark: 48 },
} as const;

/** 圆角阶梯（4pt 节奏） */
export const R = { sm: 12, md: 16, lg: 20, xl: 28, pill: 999 } as const;

/** 间距阶梯（8dp 节奏） */
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** 主按钮按压反馈 */
export const press = { activeOpacity: 0.85 } as const;

/** 小于 44dp 的可点元素统一外扩热区（WCAG/平台触控目标下限） */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

// ---------- 主题 hooks ----------

/** 当前生效的配色方案：themeMode=system 跟随系统，否则用用户固定值 */
export function useScheme(): Scheme {
  const system = useColorScheme();
  const mode = useSettingsStore((s) => s.themeMode);
  return mode === 'system' ? (system ?? 'light') : mode;
}

/** 当前调色板（组件内渲染期取用；配套 themedStyles 的双套样式表，切换零重建成本） */
export function usePalette(): Palette {
  return palettes[useScheme()];
}

/**
 * 双套样式表工厂：模块加载时为 light/dark 各建一份 StyleSheet，
 * 运行时 O(1) 按 scheme 取用——切换主题零重建、零闪烁。
 * 用法：const STYLES = themedStyles((C) => StyleSheet.create({ ...原样式体不变... }));
 * 组件内：const C = usePalette(); const styles = STYLES[useScheme()];
 */
export function themedStyles<T extends Record<string, ViewStyle | TextStyle>>(
  factory: (c: Palette) => T
): Record<Scheme, T> {
  return {
    light: StyleSheet.create(factory(palettes.light)),
    dark: StyleSheet.create(factory(palettes.dark)),
  } as Record<Scheme, T>;
}
