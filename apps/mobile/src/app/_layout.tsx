import { Tabs } from 'expo-router';
import { AiOrb } from '@/components/AiOrb';
import { View } from 'react-native';
import { useEffect } from 'react';
import { initBackgroundSync } from '@/lib/background';

// 底部 4 个 Tab + 全局 AI 悬浮球
export default function RootLayout() {
  // 后台唤醒：注册 expo-background-fetch（当日提醒通知 + 每日备课预取），失败静默
  useEffect(() => {
    initBackgroundSync();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="index" options={{ title: '驾驶舱' }} />
        <Tabs.Screen name="arsenal" options={{ title: '弹药库' }} />
        <Tabs.Screen name="dashboard" options={{ title: '仪表盘' }} />
        <Tabs.Screen name="profile" options={{ title: '我的' }} />
      </Tabs>
      <AiOrb />
    </View>
  );
}
