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

// 订阅按「客户端实例」记录：用户在「我的」换 Supabase 项目后 getSupabase() 会重建客户端，
// 若只用一个布尔量，新客户端永远拿不到订阅，登录后 email 不更新（旧客户端的回调已失效）
let subscribedClient: unknown = null;
let bootstrapToken = 0;

// 登录/会话恢复后的引导：确保云端档案存在，access_key 回填本地
async function bootstrap() {
  const sb = getSupabase();
  if (!sb) return;
  // 并发/重入保护：同一时刻只让最后一次 bootstrap 写 settingsStore
  const token = ++bootstrapToken;
  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) return;
    const { data, error } = await sb.rpc('ensure_access_key');
    if (token !== bootstrapToken) return;
    if (!error && typeof data === 'string' && data) {
      const { accessKey, update } = useSettingsStore.getState();
      if (accessKey !== data) update({ accessKey: data }); // 多设备：自动对齐到账号的 key
    }
  } catch {
    // 档案引导失败不阻塞登录态展示，下次登录 / 重进 App 会重试
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
    // 订阅变更（按客户端实例幂等：init 可能被多个页面调用，换项目后会重建客户端）
    if (subscribedClient !== sb) {
      subscribedClient = sb;
      // 参数显式宽类型（string/unknown ⊇ supabase 联合类型）：本地无 node_modules 时类型也可推断
      sb.auth.onAuthStateChange((event: string, session: unknown) => {
        const email = (session as { user?: { email?: string } } | null)?.user?.email ?? null;
        set({ email });
        if (event === 'SIGNED_IN' && session) void bootstrap();
      });
    }
    // 会话恢复：必须放到 try 里——网络异常时若直接抛出，ready 永远不置位，UI 会卡在加载态
    try {
      const { data } = await sb.auth.getSession();
      set({ email: data.session?.user?.email ?? null, ready: true });
      if (data.session) void bootstrap();
    } catch {
      set({ ready: true }); // 恢复失败按未登录处理，仍让 UI 可用
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
