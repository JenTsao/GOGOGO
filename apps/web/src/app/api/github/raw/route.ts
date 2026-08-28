import { NextRequest, NextResponse } from 'next/server';
import { fetchRawFile, isGithubConfigured } from '@/lib/github';

export const dynamic = 'force-dynamic';

// GET /api/github/raw?path=docs/数学/导数.md → 单篇 Markdown 原文
export async function GET(req: NextRequest) {
  if (!isGithubConfigured()) {
    return NextResponse.json({ error: '未配置 GITHUB_REPO（格式 owner/repo）' }, { status: 400 });
  }
  const path = req.nextUrl.searchParams.get('path');
  if (!path) return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
  try {
    const content = await fetchRawFile(path);
    return new NextResponse(content, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
  } catch (e) {
    return NextResponse.json({ error: `读取失败：${(e as Error).message}` }, { status: 502 });
  }
}
