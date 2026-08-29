import { StyleSheet, TextStyle, ViewStyle } from 'react-native';

/**
 * 全 App 设计令牌 —— 所有页面统一从这里取色 / 圆角 / 阴影，禁止散落硬编码 hex。
 * 风格：教育场景柔和卡片风（轻量 Claymorphism 落地：大圆角 + 双层软阴影 + 主色气泡）。
 * 色板基线：主色紫 #7C3AED，正文对比度 ≥ 4.5:1，次要文字 ≥ 3:1。
 */
export const C = {
  // 表面
  bg: '#F6F4FA', // 页面底色（淡紫灰）
  card: '#FFFFFF',
  surfaceAlt: '#EBE7F4', // 次级表面：分段控件轨道 / 进度条底 / 禁用底
  // 主色（教育紫）
  primary: '#7C3AED',
  primaryDeep: '#6D28D9',
  primarySoft: '#F1EAFC', // 主色浅底：选中态 / 用户气泡
  onPrimary: '#FFFFFF', // 主色之上的内容（按钮文字/图标/加载圈），替代散落的 '#fff'
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
  amberDeep: '#7A5A10', // orangeSoft 底上的警示正文（原 #8c6b1f 对比不足）
  warnDeep: '#6B5414', // 暖黄提示底上的文字
  red: '#DC2626',
  redSoft: '#FDECEC',
  roseDeep: '#B04A4A', // redSoft 底上的文字（原 #e08a8a 仅 2.6:1，不达标）
  blue: '#2563EB',
  blueSoft: '#EAF1FE',
  // 心流沉浸场景（黑底专属场景色，集中管理避免散落）
  ink: '#0D0B14',
  inkBorder: '#2A2440',
  inkBorderStrong: '#3A3355',
  inkText: '#9D93BD',
  inkSub: '#8B7FC7',
  inkDim: '#AAA6B5',
  // 代码沙盒控制台
  consoleBg: '#241F3A',
  consoleText: '#C7E8D5',
  consoleDim: '#6A6489',
} as const;

/** 专注热力阶梯（近端深、远端浅，语义化数据色，仅用于热力图） */
export const HEAT_SCALE = ['#EEEBF4', '#D5EBDD', '#9CD3AA', '#4E9A5F', '#1C5D2C'] as const;

/**
 * 液态玻璃（Liquid Glass）色层 —— 真模糊由 expo-blur（BlurView）承担，这里只管颜色与描边。
 * 规范：blur 强度 10–20px（BlurView intensity 30–60）、玻璃面透出背景、1px 受光描边模拟顶缘高光。
 * Android 无真模糊时自动降级为半透明染色（expo-blur 默认行为），观感仍成立。
 */
export const GLASS = {
  surface: 'rgba(255,255,255,0.60)', // 玻璃面：浅色场景（卡片/分段控件）
  surfaceStrong: 'rgba(255,255,255,0.78)', // 高可读玻璃面：承载正文的面板
  dark: 'rgba(255,255,255,0.08)', // 玻璃面：深色场景（心流黑底靠受光描边成形）
  border: 'rgba(255,255,255,0.65)', // 受光描边（顶缘高光）
  borderSoft: 'rgba(255,255,255,0.28)',
  darkBorder: 'rgba(255,255,255,0.18)',
} as const;

/** 玻璃面板统一受光描边 */
export const glassEdge: ViewStyle = {
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: GLASS.border,
};

/** 玻璃面板液态柔影（比卡片阴影更深更散，模拟玻璃悬浮） */
export const glassShadow: ViewStyle = StyleSheet.create({
  shadow: {
    shadowColor: '#2A1E5C',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
}).shadow;

/** 圆角阶梯（4pt 节奏） */
export const R = { sm: 12, md: 16, lg: 20, pill: 999 } as const;

/** 间距阶梯（8dp 节奏） */
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** 统一卡片阴影（iOS shadow + Android elevation 双兜底） */
export const cardShadow: ViewStyle = StyleSheet.create({
  shadow: {
    shadowColor: '#3B2D6B',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
}).shadow;

/** 主按钮按压反馈 */
export const press = { activeOpacity: 0.85 } as const;

/** 小于 44dp 的可点元素统一外扩热区（WCAG/平台触控目标下限） */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** 章节标题统一样式 */
export const sectionTitle: TextStyle = {
  fontSize: 17,
  fontWeight: '700',
  color: C.text,
  letterSpacing: 0.3,
};
