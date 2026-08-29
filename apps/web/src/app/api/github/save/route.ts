import { NextRequest, NextResponse } from 'next/server';
import { commitMarkdown, isGithubWritable } from '@/lib/github';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isAdminRequest, adminUnauthorized } from '@/lib/access';

export const dynamic = 'force-dynamic';

// 版本快照上限：防止 version_history jsonb 无限膨胀
const MAX_VERSIONS = 20;

// POST /api/github/save { path, content, message? } → 提交到 GitHub 并落版本快照
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json(adminUnauthorized(), { status: 401 });
  }
  if (!isGithubWritable()) {
    return NextResponse.json({ error: '未配置 GITHUB_REPO / GITHUB_TOKEN（需具备 repo 写权限）' }, { status: 400 });
  }
  let body: { path?: string; content?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const path = body.path?.trim();
  const content = body.content ?? '';
  if (!path || !path.endsWith('.md')) {
    return NextResponse.json({ error: '缺少 path 或仅支持 .md 文件' }, { status: 400 });
  }
  try {
    await commitMarkdown(path, content, body.message?.trim() || `知识工坊编辑 ${path}`);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  // 版本快照（obsidian_metadata.version_history，蓝皮书「版本控制」）：失败不影响保存主流程
  let versionTs: string | null = null;
  const owner = process.env.OWNER_USER_ID;
  if (owner) {
    try {
      const sb = supabaseAdmin();
      versionTs = new Date().toISOString();
      const { data: meta } = await sb
        .from('obsidian_metadata')
        .select('id, version_history')
        .eq('user_id', owner)
        .eq('file_path', path)
        .maybeSingle();
      const entry = { ts: versionTs, content };
      const history = [...((meta?.version_history as { ts: string }[]) ?? []), entry].slice(-MAX_VERSIONS);
      if (meta?.id) {
        await sb.from('obsidian_metadata').update({ version_history: history, updated_at: versionTs }).eq('id', meta.id);
      } else {
        await sb.from('obsidian_metadata').insert({ user_id: owner, file_path: path, version_history: history });
      }
    } catch {
      versionTs = null; // 快照失败静默：GitHub 提交已成功
    }
  }
  return NextResponse.json({ ok: true, versionTs });
}
