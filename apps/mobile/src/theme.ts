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
  // 主色（教育紫）
  primary: '#7C3AED',
  primaryDeep: '#6D28D9',
  primarySoft: '#F1EAFC', // 主色浅底：选中态 / 用户气泡
  // 文字
  text: '#211D33',
  text2: '#6A647F',
  text3: '#9B95AE',
  // 线
  border: '#E9E4F3',
  // 语义色（soft 为对应浅底）
  green: '#0F9D6E',
  greenSoft: '#E8F7F0',
  orange: '#D97706',
  orangeSoft: '#FDF3E3',
  red: '#DC2626',
  redSoft: '#FDECEC',
  blue: '#2563EB',
  blueSoft: '#EAF1FE',
} as const;

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

/** 章节标题统一样式 */
export const sectionTitle: TextStyle = {
  fontSize: 17,
  fontWeight: '700',
  color: C.text,
  letterSpacing: 0.3,
};
