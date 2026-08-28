// GitHub 公开仓库访问（无需 token；移动端不持有 GITHUB_TOKEN，密钥管理见 AGENTS.md）
const TIMEOUT_MS = 10000;

function withTimeout(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

// 拉取仓库全部 .md 文件路径（git/trees recursive，一次请求拿全量目录）
export async function fetchRepoPaths(repo: string, branch: string): Promise<string[]> {
  const { signal, done } = withTimeout();
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { tree?: { path: string; type: string }[] };
    return (data.tree ?? [])
      .filter((n) => n.type === 'blob' && n.path.endsWith('.md'))
      .map((n) => n.path);
  } finally {
    done();
  }
}

// 按需下载单篇 Markdown（路径逐段编码，中文文件名兼容）
export async function fetchRawFile(repo: string, branch: string, path: string): Promise<string> {
  const { signal, done } = withTimeout();
  try {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    const r = await fetch(url, { signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return text;
  } finally {
    done();
  }
}
