import { NextRequest, NextResponse } from 'next/server';
import { commitBinary, isGithubWritable, rawUrl } from '@/lib/github';
import { isAdminRequest, adminUnauthorized } from '@/lib/access';

export const dynamic = 'force-dynamic';

// POST /api/github/image { filename, base64 } → 提交 WebP 到 assets/ 并返回 raw 直链
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json(adminUnauthorized(), { status: 401 });
  }
  if (!isGithubWritable()) {
    return NextResponse.json({ error: '未配置 GITHUB_REPO / GITHUB_TOKEN（需具备 repo 写权限）' }, { status: 400 });
  }
  let body: { filename?: string; base64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const filename = (body.filename ?? '').replace(/[^\w.-]/g, '_') || 'image.webp';
  const base64 = body.base64 ?? '';
  if (!base64) return NextResponse.json({ error: '缺少 base64 数据' }, { status: 400 });
  // 宽松上限 8MB（base64 后约 11MB 文本），防止异常大图打爆请求
  if (base64.length > 11_000_000) return NextResponse.json({ error: '图片过大' }, { status: 413 });
  const path = `assets/${Date.now()}-${filename}`;
  try {
    await commitBinary(path, base64, `上传图片 ${filename}`);
    return NextResponse.json({ ok: true, url: rawUrl(path) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
