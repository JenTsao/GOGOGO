import { createClient } from '@supabase/supabase-js';

// 服务端专用：service role 绕过 RLS，仅用于 Cron 流水线与向量写入（绝不暴露给客户端）
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

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
