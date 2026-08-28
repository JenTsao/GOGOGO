// 后台唤醒：APP 退出后定时轻量同步（蓝皮书第五章「后台唤醒」）
// 1) 当日提醒 → 本地通知（去重）
// 2) 每日备课内容预取 → MMKV 离线缓存（驾驶舱云读取失败时兜底）
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager'; // defineTask 在 TaskManager 包中，BackgroundFetch 只负责注册执行
import * as Notifications from 'expo-notifications';
import { storage } from '@/store/taskStore';
import { useReminderStore, localDateStr } from '@/store/reminderStore';
import { useSettingsStore } from '@/store/settingsStore';
import { fetchDaily, DailyLearning } from '@/lib/cloud';

export const BACKGROUND_TASK = 'gaokao-background-sync';

const NOTIFIED_KEY = 'notified-reminders';
export const DAILY_CACHE_KEY = 'daily-cache';

// 前台通知展示配置（App 处于前台时也弹横幅，避免错过当日提醒）
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function notifiedIds(): string[] {
  try {
    return JSON.parse(storage.getString(NOTIFIED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

// 每日备课内容离线缓存（驾驶舱降级读取）
export function readDailyCache(): DailyLearning | null {
  try {
    const raw = storage.getString(DAILY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyLearning;
    return parsed.date === localDateStr(new Date()) ? parsed : null; // 只认当日缓存
  } catch {
    return null;
  }
}

async function syncOnce(): Promise<BackgroundFetch.BackgroundFetchResult> {
  const today = localDateStr(new Date());

  // 1) 当日未通知的提醒 → 立即本地通知
  const seen = notifiedIds();
  const fresh = useReminderStore.getState().reminders.filter((r) => r.date === today && !seen.includes(r.id));
  for (const r of fresh) {
    await Notifications.scheduleNotificationAsync({
      content: { title: '📌 今日提醒', body: r.content },
      trigger: null, // 立即触发
    });
  }
  if (fresh.length > 0) {
    // 只保留最近 200 条去重记录，防止无限增长
    storage.set(NOTIFIED_KEY, JSON.stringify([...seen, ...fresh.map((r) => r.id)].slice(-200)));
  }

  // 2) 预取每日备课内容（配置齐全才拉，失败静默——下次后台周期重试）
  const { supabaseUrl, supabaseAnonKey, accessKey } = useSettingsStore.getState();
  if (supabaseUrl && supabaseAnonKey && accessKey) {
    try {
      const daily = await fetchDaily({ supabaseUrl, supabaseAnonKey, accessKey }, today);
      if (daily) storage.set(DAILY_CACHE_KEY, JSON.stringify(daily));
    } catch {
      // 后台任务不允许抛错，失败留给下次
    }
  }

  return BackgroundFetch.BackgroundFetchResult.NewData;
}

// App 启动时注册：应用初始化（权限 + defineTask + registerTaskAsync）
export async function initBackgroundSync(): Promise<void> {
  // 通知权限：Android 13+ 需要显式请求；拒绝后仅失去通知，不影响其他功能
  try {
    const current = await Notifications.getPermissionsAsync();
    if (!current.granted) await Notifications.requestPermissionsAsync();
  } catch {
    // 模拟器/未配置环境可能直接失败，静默跳过
  }

  try {
    TaskManager.defineTask(BACKGROUND_TASK, syncOnce);
    await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
      minimumInterval: 15 * 60, // 系统保证不小于该间隔；实际由 OS 节流决定
      stopOnTerminate: false, // APP 被杀后继续
      startOnBoot: true, // 开机自启
    });
  } catch {
    // Expo Go 下 Android 不支持 background fetch，构建版才生效；失败不影响 App 使用
  }

  // 首次启动也跑一次，让「今日提醒通知」无需等后台周期
  try {
    await syncOnce();
  } catch {
    // 静默
  }
}
