import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AiOrb } from '@/components/AiOrb';
import { View, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initBackgroundSync } from '@/lib/background';
import { usePalette, useScheme } from '@/theme';

// Tab 栏液态玻璃背景：真模糊（Android 经 dimezis 引擎；iOS 原生 UIVisualEffectView）
// 半透明玻璃面叠在模糊层上，低性能设备自动降级为纯半透明染色
// tint 随主题切换：浅色玻璃提亮下层内容，深色玻璃压暗（BlurView 自带材质，无法用调色板直接控制）
const GlassTabBackground = ({ tint }: { tint: 'light' | 'dark' }) => (
  <BlurView
    intensity={tint === 'dark' ? 55 : 40}
    tint={tint}
    experimentalBlurMethod="dimezisBlurView"
    style={StyleSheet.absoluteFill}
  />
);

// Tab 图标映射：outline = 未选中，实心 = 选中（单一图标家族，视觉语言一致）
const TAB_ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  index: { on: 'rocket', off: 'rocket-outline' },
  arsenal: { on: 'layers', off: 'layers-outline' },
  dashboard: { on: 'stats-chart', off: 'stats-chart-outline' },
  profile: { on: 'person', off: 'person-outline' },
};

// Tab 栏内容高度（不含手势条；react-navigation 会在内部自动叠加底部安全区 padding）
// AiOrb 默认停靠位置引用同一数值（见 AiOrb.tsx 注释），修改时两处保持同步
const TAB_BAR_CONTENT_HEIGHT = 60;

// 底部 4 个 Tab + 全局 AI 悬浮球
export default function RootLayout() {
  const insets = useSafeAreaInsets();
  const C = usePalette();
  const scheme = useScheme();

  // 后台唤醒：注册 expo-background-fetch（当日提醒通知 + 每日备课预取），失败静默
  useEffect(() => {
    initBackgroundSync();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* 状态栏图标色随主题：深色页面配浅图标，反之亦然 */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: C.primary,
          tabBarInactiveTintColor: C.text3,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          // 液态玻璃 Tab 栏：模糊背景 + 半透明玻璃面 + 受光描边
          tabBarBackground: () => <GlassTabBackground tint={scheme} />,
          tabBarStyle: {
            backgroundColor: C.glassSurface,
            borderTopColor: C.glassBorder,
            borderTopWidth: StyleSheet.hairlineWidth,
            // 底部安全区自适应（全面屏手势条高度因机型而异，iQOO Neo10 约 24-27dp）
            height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
            paddingTop: 4,
          },
          tabBarIcon: ({ focused, color, size }) => {
            const icon = TAB_ICONS[route.name];
            return <Ionicons name={(focused ? icon?.on : icon?.off) ?? 'ellipse'} size={size} color={color} />;
          },
        })}
      >
        <Tabs.Screen name="index" options={{ title: '驾驶舱' }} />
        <Tabs.Screen name="arsenal" options={{ title: '弹药库' }} />
        <Tabs.Screen name="dashboard" options={{ title: '仪表盘' }} />
        <Tabs.Screen name="profile" options={{ title: '我的' }} />
      </Tabs>
      <AiOrb />
    </View>
  );
}
