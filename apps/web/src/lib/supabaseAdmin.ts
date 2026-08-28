import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 服务端专用：service role 绕过 RLS，仅用于 Cron 流水线与向量写入（绝不暴露给客户端）
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

let client: SupabaseClient | null = null;

// 懒初始化：build 期无环境变量时不能在模块加载阶段抛错（next build 会收集页面数据）
export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    if (!url || !serviceKey) {
      throw new Error('未配置 SUPABASE_URL / SERVICE_ROLE_KEY（.env.local）');
    }
    client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return client;
}

// 单用户应用：云端写入归属此用户（Supabase auth.users 中的 UUID）
export function ownerUserId(): string {
  return process.env.OWNER_USER_ID ?? '';
}

export function requireAdminEnv(): string {
  if (!url || !serviceKey) throw new Error('未配置 SUPABASE_URL / SERVICE_ROLE_KEY（.env.local）');
  const owner = ownerUserId();
  if (!owner) throw new Error('未配置 OWNER_USER_ID（.env.local）');
  return owner;
}
