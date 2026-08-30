import { View, StyleSheet } from 'react-native';
import { usePalette } from '@/theme';

/**
 * 页面环境光斑：绝对定位的三个大圆色斑，铺在页面内容层之下。
 * 半透玻璃卡（glassCard）「透」出这些色彩，产生折射层次——
 * 纯色底上的半透玻璃几乎看不出玻璃感，光斑是静态玻璃的「被透物」。
 * 零依赖实现（无 expo-linear-gradient），pointerEvents 关闭不挡触控。
 */
export function AmbientGlow() {
  const C = usePalette();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.blob, styles.primary, { backgroundColor: C.glowPrimary }]} />
      <View style={[styles.blob, styles.blue, { backgroundColor: C.glowBlue }]} />
      <View style={[styles.blob, styles.green, { backgroundColor: C.glowGreen }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  blob: {
    position: 'absolute',
    borderRadius: 999,
  },
  // 主光斑：页面右上，笼罩倒计时/头像卡区域
  primary: { width: 320, height: 320, top: -100, right: -80 },
  // 次光斑：左中，透出中部卡片
  blue: { width: 260, height: 260, top: 260, left: -110 },
  // 微光斑：右下，透出尾部卡片
  green: { width: 220, height: 220, top: 640, right: -90 },
});
