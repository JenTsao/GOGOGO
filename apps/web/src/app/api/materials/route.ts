import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminEnv, ownerUserId } from '@/lib/supabaseAdmin';
import { isAdminRequest, adminUnauthorized } from '@/lib/access';
import { collectMaterials, verifySources } from '@/lib/collector/pool';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/materials → 素材池列表（管理台「素材池」页）
// 查询参数：category / topic / difficulty / minFit / status / limit / q（标题模糊）
export async function GET(req: NextRequest) {
  try {
    requireAdminEnv();
    const sp = req.nextUrl.searchParams;
    let q = supabaseAdmin()
      .from('source_materials')
      .select(
        'id,source_name,category,subject,url,title,published_at,word_count,summary_zh,gaokao_fit,topic,genre,difficulty,risk,form,status,selected_on,created_at'
      )
      .eq('user_id', ownerUserId())
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(sp.get('limit')) || 60, 200));

    const category = sp.get('category');
    if (category) q = q.eq('category', category);
    const topic = sp.get('topic');
    if (topic) q = q.eq('topic', topic);
    const difficulty = sp.get('difficulty');
    if (difficulty) q = q.eq('difficulty', difficulty);
    const status = sp.get('status');
    if (status) q = q.eq('status', status);
    const minFit = sp.get('minFit');
    if (minFit) q = q.gte('gaokao_fit', Number(minFit));
    const kw = sp.get('q');
    if (kw) q = q.ilike('title', `%${kw}%`);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json({ materials: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: `读取素材池失败：${(e as Error).message}` }, { status: 500 });
  }
}

// POST /api/materials → 手动采集（?action=collect）或验证源（?action=verify）
// 采集会产生 LLM 费用且耗时，必须鉴权（定时任务走 /api/cron/collect 的 CRON_SECRET）
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json(adminUnauthorized(), { status: 401 });
  }
  const action = req.nextUrl.searchParams.get('action') ?? 'collect';
  try {
    if (action === 'verify') {
      const result = await verifySources();
      return NextResponse.json({ ok: true, sources: result });
    }
    const body = (await req.json().catch(() => ({}))) as {
      maxPerRun?: number;
      skipScoring?: boolean;
    };
    const report = await collectMaterials({
      maxPerRun: Math.min(Number(body.maxPerRun) || 12, 40),
      skipScoring: body.skipScoring === true,
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
