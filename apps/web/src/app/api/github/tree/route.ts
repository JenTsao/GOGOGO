import { NextResponse } from 'next/server';
import { fetchRepoTree, isGithubConfigured } from '@/lib/github';

export const dynamic = 'force-dynamic';

// GET /api/github/tree → Markdown 文件树（token 仅服务端使用）
export async function GET() {
  if (!isGithubConfigured()) {
    return NextResponse.json({ error: '未配置 GITHUB_REPO（格式 owner/repo）' }, { status: 400 });
  }
  try {
    const entries = await fetchRepoTree();
    return NextResponse.json({ entries });
  } catch (e) {
    return NextResponse.json({ error: `拉取目录树失败：${(e as Error).message}` }, { status: 502 });
  }
}
