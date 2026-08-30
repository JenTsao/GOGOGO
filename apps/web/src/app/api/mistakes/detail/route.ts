import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminEnv } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// 错题长文本按需加载：列表页为压缩 RSC payload 不携带 transcript（单条上限 5000 字 × 最多 500 条），
// 打开详情弹窗时才按 id 取一次。归属校验与列表同源（OWNER + user_id 双重约束）
export async function GET(req: NextRequest) {
  const owner = requireAdminEnv();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });
  const { data, error } = await supabaseAdmin()
    .from('mistakes')
    .select('id, transcript')
    .eq('id', id)
    .eq('user_id', owner)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '未找到该错题' }, { status: 404 });
  return NextResponse.json({ id: data.id, transcript: data.transcript });
}
