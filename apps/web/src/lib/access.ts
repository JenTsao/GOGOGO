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

// 管理台写接口鉴权（GitHub 提交 / 图片上传 / LLM 精炼 / 手动向量化）：
// 这些接口一旦公开部署，任何人都能往你的 Obsidian 仓库写文件、烧 LLM 额度，必须可加闸。
// 配置为可选：设置 ADMIN_TOKEN 后即强制校验；未设置时保持原行为（本地开发不被挡）。
// 前端需带上 header：x-admin-key: <ADMIN_TOKEN>
export function isAdminRequest(req: Request): boolean {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return true; // 未启用：显式沿用旧行为
  const header = req.headers.get('x-admin-key') ?? '';
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  return header === adminToken || bearer === adminToken;
}

// 统一 401 响应文案（不泄露 token 是否存在以外的信息）
export function adminUnauthorized() {
  return { error: '未授权：请配置并携带 ADMIN_TOKEN（x-admin-key）' };
}
