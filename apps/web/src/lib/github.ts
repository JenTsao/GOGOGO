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

// 拉取仓库完整文件树（递归），仅保留 markdown 文件
export async function fetchRepoTree(): Promise<TreeEntry[]> {
  const res = await fetch(
    `https://api.github.com/repos/${githubConfig.repo}/git/trees/${githubConfig.branch}?recursive=1`,
    { headers: headers(), next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = (await res.json()) as {
    tree?: { path: string; type: string }[];
    truncated?: boolean;
  };
  return (data.tree ?? [])
    .filter((n) => n.type === 'blob' && n.path.endsWith('.md'))
    .map((n) => ({ path: n.path, type: 'blob' as const }));
}

// 读取单个文件的原始内容
export async function fetchRawFile(path: string): Promise<string> {
  const clean = path.replace(/^\/+/, '');
  if (clean.includes('..')) throw new Error('非法路径');
  const res = await fetch(
    `https://raw.githubusercontent.com/${githubConfig.repo}/${githubConfig.branch}/${encodeURIComponent(clean)}`,
    { headers: headers(), next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`GitHub raw ${res.status}`);
  return res.text();
}
