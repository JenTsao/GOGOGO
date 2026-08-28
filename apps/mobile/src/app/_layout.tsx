import { Tabs } from 'expo-router';
import { AiOrb } from '@/components/AiOrb';
import { View } from 'react-native';

// 底部 4 个 Tab + 全局 AI 悬浮球
export default function RootLayout() {
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
