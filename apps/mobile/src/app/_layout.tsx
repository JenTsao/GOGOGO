import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AiOrb } from '@/components/AiOrb';
import { View, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initBackgroundSync } from '@/lib/background';
import { C } from '@/theme';

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

  // 后台唤醒：注册 expo-background-fetch（当日提醒通知 + 每日备课预取），失败静默
  useEffect(() => {
    initBackgroundSync();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* 浅底显式锁定深色图标：防止跟随系统深色模式时图标隐入白底 */}
      <StatusBar style="dark" />
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: C.primary,
          tabBarInactiveTintColor: C.text3,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarStyle: {
            backgroundColor: C.card,
            borderTopColor: C.border,
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
