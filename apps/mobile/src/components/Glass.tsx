import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import {
  GLASS_BLUR,
  glassRim,
  glassShadowFor,
  usePalette,
  useScheme,
  type Scheme,
} from '@/theme';

type Variant = 'tab' | 'sheet' | 'card';

type GlassProps = {
  children?: React.ReactNode;
  /** 模糊档位：tab 栏 / 底部 sheet / 轻卡 */
  variant?: Variant;
  /** 正文面板用 Strong 面色，保证可读 */
  strong?: boolean;
  /** 是否叠加液态柔影（sheet / 悬浮卡建议开） */
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * 液态玻璃容器：BlurView（真模糊）+ 半透染色面 + 顶缘受光高光。
 * Android 经 experimentalBlurMethod=dimezisBlurView；低端机模糊失败时仍有半透面兜底。
 * 滚动列表内大量使用请优先 glassRim 静态玻璃，避免每行开一层 BlurView。
 */
export function Glass({
  children,
  variant = 'card',
  strong = false,
  elevated = false,
  style,
  contentStyle,
}: GlassProps) {
  const C = usePalette();
  const scheme = useScheme();
  const intensity = GLASS_BLUR[variant][scheme];
  const fill = strong ? C.glassSurfaceStrong : C.glassSurface;

  return (
    <View
      style={[
        styles.wrap,
        elevated && glassShadowFor(scheme),
        style,
      ]}
    >
      <BlurView
        intensity={intensity}
        tint={scheme}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      {/* 半透染色：让玻璃有材质厚度，并兜底 Android 模糊降级 */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      {/* 顶缘受光高光：模拟玻璃折射 */}
      <View
        pointerEvents="none"
        style={[
          styles.highlight,
          { backgroundColor: scheme === 'dark' ? C.glassHighlightSoft : C.glassHighlight },
        ]}
      />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

/** 静态玻璃卡（无 BlurView）：顶高光 + 弱描边 + 半透面，适合列表项 */
export function GlassCard({
  children,
  style,
  elevated = true,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}) {
  const C = usePalette();
  const scheme = useScheme();
  return (
    <View
      style={[
        styles.staticCard,
        { backgroundColor: C.glassSurface },
        glassRim(C),
        elevated && glassShadowFor(scheme),
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          styles.highlight,
          { backgroundColor: scheme === 'dark' ? C.glassHighlightSoft : C.glassHighlight },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    position: 'relative',
  },
  content: {
    position: 'relative',
    zIndex: 1,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth * 2,
    zIndex: 2,
  },
  staticCard: {
    overflow: 'hidden',
    position: 'relative',
  },
});

export type { Scheme };
