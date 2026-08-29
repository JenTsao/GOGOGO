// 服务端 GitHub 访问：配置在 .env.local，token 永不下发客户端
export const githubConfig = {
  repo: process.env.GITHUB_REPO ?? '', // 格式：owner/repo
  branch: process.env.GITHUB_BRANCH ?? 'main',
  token: process.env.GITHUB_TOKEN ?? '',
};

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubConfig.token) h.Authorization = `Bearer ${githubConfig.token}`;
  return h;
}

export function isGithubConfigured(): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(githubConfig.repo);
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
}

// 逐段编码：保留 '/' 作为目录分隔符，其余按段 encodeURIComponent。
// 直接对整个 path 编码会把 '/' 变成 %2F，GitHub 不会还原 → 子目录笔记全部 404（中文路径同理需要逐段编码）
function encodeRepoPath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .filter((seg) => seg.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

// 拉取仓库完整文件树（递归），仅保留 markdown 文件
// truncated = GitHub 截断标记（文件数 >10 万或体积 >7MB）：为 true 时树是残缺的，
// 绝不能据此做「幽灵笔记清理」，否则会把树外的笔记元数据与向量全部误删
export async function fetchRepoTree(): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const res = await fetch(
    `https://api.github.com/repos/${githubConfig.repo}/git/trees/${githubConfig.branch}?recursive=1`,
    { headers: headers(), cache: 'no-store' } // 同步流程必须拿实时树，否则新建笔记会被误判为幽灵
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = (await res.json()) as {
    tree?: { path: string; type: string }[];
    truncated?: boolean;
  };
  return {
    entries: (data.tree ?? [])
      .filter((n) => n.type === 'blob' && n.path.endsWith('.md'))
      .map((n) => ({ path: n.path, type: 'blob' as const })),
    truncated: data.truncated === true,
  };
}

// 读取单个文件的原始内容
export async function fetchRawFile(path: string): Promise<string> {
  const clean = path.replace(/^\/+/, '');
  // 按路径分段判断，避免误伤「高等数学..进阶」这类含连续点的合法文件名
  if (clean.split('/').some((seg) => seg === '..')) throw new Error('非法路径');
  const res = await fetch(
    `https://raw.githubusercontent.com/${githubConfig.repo}/${githubConfig.branch}/${encodeRepoPath(clean)}`,
    { headers: headers(), next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`GitHub raw ${res.status}`);
  return res.text();
}

// ---------- 写路径（保存 / 传图）：走 contents API，需 GITHUB_TOKEN 具备 repo 写权限 ----------

export function isGithubWritable(): boolean {
  return isGithubConfigured() && !!githubConfig.token;
}

// 防路径穿越：统一校验写入目标
function assertSafePath(path: string): void {
  const clean = path.replace(/^\/+/, '');
  if (!clean || clean.includes('..') || clean.includes('\\')) throw new Error('非法路径');
}

// 取文件当前 SHA（不存在返回 null，供新建文件）
export async function getFileSha(path: string): Promise<string | null> {
  assertSafePath(path);
  const res = await fetch(
    `https://api.github.com/repos/${githubConfig.repo}/contents/${encodeRepoPath(path)}?ref=${githubConfig.branch}`,
    { headers: headers(), cache: 'no-store' }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = (await res.json()) as { sha?: string };
  return data.sha ?? null;
}

// 提交文本文件（Markdown 编辑保存）
export async function commitMarkdown(path: string, content: string, message: string): Promise<void> {
  assertSafePath(path);
  const sha = await getFileSha(path);
  const res = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${encodeRepoPath(path)}`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: githubConfig.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`提交失败 ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
  }
}

// 提交二进制文件（拖拽上传的 WebP 图片），content 为 base64
export async function commitBinary(path: string, base64: string, message: string): Promise<void> {
  assertSafePath(path);
  const sha = await getFileSha(path);
  const res = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${encodeRepoPath(path)}`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64, branch: githubConfig.branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`图片提交失败 ${res.status}`);
}

// 原始文件直链（图片在 Markdown 中引用）
export function rawUrl(path: string): string {
  return `https://raw.githubusercontent.com/${githubConfig.repo}/${githubConfig.branch}/${encodeRepoPath(path)}`;
}
