import { create } from 'zustand';
import { getSupabase } from '@/lib/supabase';
import { useSettingsStore } from './settingsStore';

// Supabase Auth（多设备一致）：登录 = 身份引导层。
// 设计取舍：不重写既有同步链路——登录后调用 ensure_access_key RPC 拿到该账号的
// access_key 回填 settingsStore，全部数据同步（tasks/timer/mistakes/mood/daily/weekly）
// 经既有 access-key 通道自动归属同一账号，多设备登录即收敛。
interface AuthState {
  email: string | null; // 已登录邮箱（null = 未登录）
  ready: boolean; // 会话恢复完成（UI 判断显示登录态还是加载态）
  busy: boolean;
  error: string | null;
  init: () => Promise<void>; // App 启动调用：恢复会话 + 订阅变更（幂等）
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

let subscribed = false;

// 登录/会话恢复后的引导：确保云端档案存在，access_key 回填本地
async function bootstrap() {
  const sb = getSupabase();
  if (!sb) return;
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session) return;
  const { data, error } = await sb.rpc('ensure_access_key');
  if (!error && typeof data === 'string' && data) {
    const { accessKey, update } = useSettingsStore.getState();
    if (accessKey !== data) update({ accessKey: data }); // 多设备：自动对齐到账号的 key
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  email: null,
  ready: false,
  busy: false,
  error: null,

  init: async () => {
    const sb = getSupabase();
    if (!sb) {
      set({ ready: true }); // 未配置项目 → 视为就绪（登录区提示先配置）
      return;
    }
    // 会话恢复
    const { data } = await sb.auth.getSession();
    set({ email: data.session?.user?.email ?? null, ready: true });
    if (data.session) void bootstrap();
    // 订阅变更（幂等：init 可能被多个页面调用）
    if (!subscribed) {
      subscribed = true;
      sb.auth.onAuthStateChange((event, session) => {
        set({ email: session?.user?.email ?? null });
        if (event === 'SIGNED_IN' && session) void bootstrap();
      });
    }
  },

  signIn: async (email, password) => {
    const sb = getSupabase();
    if (!sb) {
      set({ error: '请先在上方填写 Supabase 地址与 Anon Key' });
      return;
    }
    set({ busy: true, error: null });
    const { error: e } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    set({ busy: false, error: e ? e.message : null }); // 成功由 onAuthStateChange 驱动
  },

  signUp: async (email, password) => {
    const sb = getSupabase();
    if (!sb) {
      set({ error: '请先在上方填写 Supabase 地址与 Anon Key' });
      return;
    }
    set({ busy: true, error: null });
    const { data, error: e } = await sb.auth.signUp({ email: email.trim(), password });
    if (e) {
      set({ busy: false, error: e.message });
      return;
    }
    set({ busy: false, error: data.session ? null : '注册成功，请查收确认邮件后再登录' });
  },

  signOut: async () => {
    const sb = getSupabase();
    if (!sb) return;
    set({ busy: true });
    await sb.auth.signOut();
    // 保留本地数据与手动配置；accessKey 留存（手动填过的话仍可用）
    set({ busy: false, email: null, error: null });
  },
}));
