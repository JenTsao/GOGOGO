'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin, requireAdminEnv } from '@/lib/supabaseAdmin';

// 错题管理 server actions：管理台单用户场景，服务端用 OWNER 归属约束（service role 不越过归属校验）

/** 标记/取消掌握（雷达「学科掌握」维度的数据源） */
export async function toggleMastered(id: string, current: boolean | null): Promise<void> {
  const owner = requireAdminEnv();
  const { error } = await supabaseAdmin()
    .from('mistakes')
    .update({ is_mastered: !current })
    .eq('id', id)
    .eq('user_id', owner);
  if (error) throw new Error(error.message);
  revalidatePath('/mistakes');
  revalidatePath('/');
}

/** 删除错题：删行 + 尽力清理 Storage 里的图片/语音（路径从公共 URL 提取） */
export async function deleteMistake(id: string): Promise<void> {
  const owner = requireAdminEnv();
  const { data: row } = await supabaseAdmin()
    .from('mistakes')
    .select('image_urls, voice_note_url')
    .eq('id', id)
    .eq('user_id', owner)
    .maybeSingle();

  const { error } = await supabaseAdmin().from('mistakes').delete().eq('id', id).eq('user_id', owner);
  if (error) throw new Error(error.message);

  // 存储清理失败不阻塞删除（孤儿文件可定期手动清理）
  try {
    const paths = [
      ...((row?.image_urls as string[]) ?? []),
      ...((row?.voice_note_url ? [row.voice_note_url] : []) as string[]),
    ]
      .map((url) => {
        const marker = '/object/public/mistakes/';
        const idx = url.indexOf(marker);
        return idx >= 0 ? url.slice(idx + marker.length) : null;
      })
      .filter((p): p is string => !!p);
    if (paths.length > 0) {
      await supabaseAdmin().storage.from('mistakes').remove(paths);
    }
  } catch {
    // 静默：行已删，存储孤儿不影响功能
  }

  revalidatePath('/mistakes');
  revalidatePath('/');
}
