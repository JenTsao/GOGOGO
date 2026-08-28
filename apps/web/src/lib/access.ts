import { supabaseAdmin } from './supabaseAdmin';

// 设备访问密钥鉴权：与 get_daily_by_key RPC 同一密钥体系
// 移动端上传/读取错题时带 x-access-key，服务端用 service role 反查归属用户
export async function getUserByAccessKey(
  accessKey: string | null
): Promise<{ userId: string } | null> {
  if (!accessKey) return null;
  const { data, error } = await supabaseAdmin()
    .from('profiles')
    .select('user_id')
    .eq('access_key', accessKey)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return { userId: data[0].user_id as string };
}

export function accessKeyFromRequest(req: Request): string | null {
  return req.headers.get('x-access-key');
}
