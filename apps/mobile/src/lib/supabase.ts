import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { storage } from '@/store/taskStore';
import { useSettingsStore } from '@/store/settingsStore';

// 移动端 Supabase 客户端（懒创建）：
// url/anonKey 来自 settingsStore（用户在「我的」填写自己的项目），会话经 MMKV 适配器持久化（重启免登录）
const MMKVAuthStorage = {
  getItem: async (key: string): Promise<string | null> => storage.getString(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    storage.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    storage.delete(key);
  },
};

let client: SupabaseClient | null = null;
let builtWith = '';

export function getSupabase(): SupabaseClient | null {
  const { supabaseUrl, supabaseAnonKey } = useSettingsStore.getState();
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const sig = `${supabaseUrl}|${supabaseAnonKey}`;
  // 配置变更（用户换项目）时重建客户端
  if (!client || builtWith !== sig) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: MMKVAuthStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false, // RN 无浏览器 URL，必须关闭
      },
    });
    builtWith = sig;
  }
  return client;
}
