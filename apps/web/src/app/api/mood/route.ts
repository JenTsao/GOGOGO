import { NextRequest, NextResponse } from 'next/server';
import { getUserByAccessKey } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// POST /api/mood { date, emojiCode, summary?, voiceBase64? }（header x-access-key）
// 情绪打卡云端落库（蓝皮书 mood_checkins 表）：语音上传 Storage mood 桶，user_id+date 唯一（同日重打覆盖）
export async function POST(req: NextRequest) {
  let body: { date?: unknown; emojiCode?: unknown; summary?: unknown; voiceBase64?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const user = await getUserByAccessKey(req.headers.get('x-access-key'));
  if (!user) return NextResponse.json({ error: '访问密钥无效或缺失' }, { status: 401 });
  const owner = user.userId;

  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const emojiCode = typeof body.emojiCode === 'string' && body.emojiCode.length <= 8 ? body.emojiCode : null;
  if (!date || !emojiCode) return NextResponse.json({ error: 'date（YYYY-MM-DD）与 emojiCode 必填' }, { status: 400 });
  const summary = typeof body.summary === 'string' ? body.summary.slice(0, 200) : null;

  // 语音（可选）：mood 桶按 owner 目录隔离，同日覆盖
  let voiceUrl: string | null = null;
  if (typeof body.voiceBase64 === 'string' && body.voiceBase64.length > 0) {
    if (body.voiceBase64.length > 3_000_000) {
      return NextResponse.json({ error: '语音过大（>2.2MB），请缩短录音' }, { status: 413 });
    }
    const buf = Buffer.from(body.voiceBase64, 'base64');
    const objectPath = `${owner}/mood-${date}.m4a`;
    const { error: upErr } = await supabaseAdmin()
      .storage.from('mood')
      .upload(objectPath, buf, { contentType: 'audio/mp4', upsert: true });
    if (upErr) return NextResponse.json({ error: `语音上传失败：${upErr.message}` }, { status: 500 });
    voiceUrl = supabaseAdmin().storage.from('mood').getPublicUrl(objectPath).data.publicUrl;
  }

  const { data, error } = await supabaseAdmin()
    .from('mood_checkins')
    .upsert(
      { user_id: owner, date, emoji_code: emojiCode, daily_summary: summary, voice_note_url: voiceUrl },
      { onConflict: 'user_id,date' }
    )
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: `落库失败：${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, id: (data as { id: string }).id, voiceUrl });
}
