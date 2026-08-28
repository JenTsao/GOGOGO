import { NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminEnv, ownerUserId } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET /api/mistakes/pool → 编译资源池用错题元数据（学科/标签/日期）
// 归属 OWNER_USER_ID（管理台自身为个人部署的可信环境；不含图片内容，图片 URL 本就是公共桶地址）
export async function GET() {
  try {
    requireAdminEnv();
    const { data, error } = await supabaseAdmin()
      .from('mistakes')
      .select('id, subject, tags, image_urls, created_at')
      .eq('user_id', ownerUserId())
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return NextResponse.json({ mistakes: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: `读取错题失败：${(e as Error).message}` }, { status: 500 });
  }
}
