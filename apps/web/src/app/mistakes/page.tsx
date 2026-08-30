import { supabaseAdmin, requireAdminEnv } from '@/lib/supabaseAdmin';
import { MistakesBoard, type MistakeRow } from './MistakesBoard';

export const dynamic = 'force-dynamic';

// 错题本管理页：手机端收录的错题在这里浏览与治理（筛选/大图/掌握标记/删除）
export default async function MistakesPage() {
  let rows: MistakeRow[] = [];
  let error: string | null = null;
  try {
    const owner = requireAdminEnv();
    const { data, error: dbErr } = await supabaseAdmin()
      .from('mistakes')
      // transcript（单条上限 5000 字）不进列表 payload：500 条时最大头，详情弹窗按需经 /api/mistakes/detail 取
      .select('id, subject, tags, image_urls, voice_note_url, is_mastered, summary, created_at')
      .eq('user_id', owner)
      .order('created_at', { ascending: false })
      .limit(500);
    if (dbErr) throw new Error(dbErr.message);
    rows = (data ?? []) as MistakeRow[];
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <>
      <h1 className="page-title">错题本</h1>
      {error ? (
        <div className="panel">
          <p className="placeholder">云端数据不可用：{error}</p>
        </div>
      ) : (
        <MistakesBoard initial={rows} />
      )}
    </>
  );
}
