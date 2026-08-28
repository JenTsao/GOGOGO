import { NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminEnv, ownerUserId } from '@/lib/supabaseAdmin';
import { getUserByAccessKey, accessKeyFromRequest } from '@/lib/access';

export const dynamic = 'force-dynamic';

// 错题本云代理：移动端经此上传/读取（service role 写 Storage 与 mistakes 表）
// 鉴权：x-access-key 反查 profiles.access_key → user_id（不暴露 service key 给客户端）

const BUCKET = 'mistakes';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_VOICE_BYTES = 3 * 1024 * 1024;

// GET /api/mistakes → 最近 50 条（含编译资源池使用）
export async function GET(req: Request) {
  const user = await getUserByAccessKey(accessKeyFromRequest(req));
  if (!user) return NextResponse.json({ error: '访问密钥无效' }, { status: 401 });
  try {
    const { data, error } = await supabaseAdmin()
      .from('mistakes')
      .select('id, subject, tags, image_urls, voice_note_url, created_at')
      .eq('user_id', user.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return NextResponse.json({ mistakes: data });
  } catch (e) {
    return NextResponse.json({ error: `读取错题失败：${(e as Error).message}` }, { status: 500 });
  }
}

// POST /api/mistakes —— body: { subject, tags, imageBase64, imageMime, voiceBase64?, voiceMime?, createdAt? }
export async function POST(req: Request) {
  const user = await getUserByAccessKey(accessKeyFromRequest(req));
  if (!user) return NextResponse.json({ error: '访问密钥无效' }, { status: 401 });

  try {
    requireAdminEnv(); // 校验环境变量，给出可读报错
    const body = (await req.json()) as {
      subject?: string;
      tags?: string[];
      imageBase64?: string;
      imageMime?: string;
      voiceBase64?: string;
      voiceMime?: string;
      createdAt?: string;
    };
    const subject = (body.subject ?? '').trim();
    if (!subject) return NextResponse.json({ error: '缺少学科' }, { status: 400 });
    if (!body.imageBase64) return NextResponse.json({ error: '缺少错题图片' }, { status: 400 });

    const imageBuf = Buffer.from(body.imageBase64, 'base64');
    if (imageBuf.length === 0 || imageBuf.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: '图片大小超出限制（压缩后 ≤3MB）' }, { status: 400 });
    }
    const ext = body.imageMime === 'image/png' ? 'png' : 'jpg';
    const stamp = body.createdAt ?? new Date().toISOString();
    const imagePaths: string[] = [];

    // 图片上传：mistakes/{userId}/{ts}.{ext}
    const imagePath = `${user.userId}/${stamp.replace(/[:.]/g, '-')}.${ext}`;
    const { error: upErr } = await supabaseAdmin()
      .storage.from(BUCKET)
      .upload(imagePath, imageBuf, { contentType: body.imageMime ?? 'image/jpeg', upsert: false });
    if (upErr) throw new Error(`图片上传失败：${upErr.message}`);
    imagePaths.push(imagePath);

    // 语音反思（可选）
    let voiceUrl: string | null = null;
    if (body.voiceBase64) {
      const voiceBuf = Buffer.from(body.voiceBase64, 'base64');
      if (voiceBuf.length > MAX_VOICE_BYTES) {
        return NextResponse.json({ error: '语音文件超出限制（≤3MB）' }, { status: 400 });
      }
      const voicePath = `${user.userId}/${stamp.replace(/[:.]/g, '-')}.m4a`;
      const { error: vErr } = await supabaseAdmin()
        .storage.from(BUCKET)
        .upload(voicePath, voiceBuf, { contentType: body.voiceMime ?? 'audio/mp4', upsert: false });
      if (vErr) throw new Error(`语音上传失败：${vErr.message}`);
      voiceUrl = supabaseAdmin().storage.from(BUCKET).getPublicUrl(voicePath).data.publicUrl;
    }

    // 公共读 bucket → getPublicUrl；否则需签名 URL（个人应用选公开读，写永远 service-only）
    const imageUrl = supabaseAdmin().storage.from(BUCKET).getPublicUrl(imagePath).data.publicUrl;

    const { data, error } = await supabaseAdmin()
      .from('mistakes')
      .insert({
        user_id: user.userId,
        subject,
        tags: body.tags ?? [],
        image_urls: [imageUrl],
        voice_note_url: voiceUrl,
      })
      .select('id')
      .single();
    if (error) throw new Error(`写入失败：${error.message}`);

    return NextResponse.json({ id: data.id, imageUrl, voiceUrl, owner: ownerUserId() === user.userId ? 'owner' : 'member' });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
