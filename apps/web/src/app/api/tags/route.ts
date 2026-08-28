import { NextRequest, NextResponse } from 'next/server';
import { requireAdminEnv, supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// 层级标签树管理（语义检索中心左栏）
// 数据源：obsidian_metadata.tags（sync 时从 #行内标签 与 frontmatter 提取）

interface TagRow {
  file_path: string;
  tags: string[];
}

function buildTree(rows: TagRow[]) {
  const root = { name: '', path: '', count: 0, children: [] as TreeNode[] };
  interface TreeNode {
    name: string;
    path: string;
    count: number;
    children: TreeNode[];
  }
  const ensure = (parts: string[]): TreeNode => {
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts.slice(0, i + 1).join('/');
      let next = cur.children.find((c) => c.path === p);
      if (!next) {
        next = { name: parts[i], path: p, count: 0, children: [] };
        cur.children.push(next);
      }
      cur = next;
    }
    return cur;
  };
  const byPath: Record<string, string[]> = {};
  for (const row of rows) {
    byPath[row.file_path] = row.tags ?? [];
    for (const tag of row.tags ?? []) {
      ensure(tag.split('/')); // 确保树节点存在（count 稍后由 countMap 统一重算）
    }
  }
  // 重算 count：节点 count = 拥有以该 path 为前缀标签的去重笔记数
  const countMap = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      const parts = tag.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('/');
        if (!countMap.has(p)) countMap.set(p, new Set());
        countMap.get(p)!.add(row.file_path);
      }
    }
  }
  const finalize = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      n.count = countMap.get(n.path)?.size ?? 0;
      finalize(n.children);
      nodes.sort((a, b) => a.name.localeCompare(b.name));
    }
  };
  finalize(root.children);
  return { tree: root.children, byPath };
}

// GET → 标签树 + 每篇笔记的标签映射
export async function GET() {
  try {
    const owner = requireAdminEnv();
    const { data, error } = await supabaseAdmin()
      .from('obsidian_metadata')
      .select('file_path, tags')
      .eq('user_id', owner);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as TagRow[];
    const { tree, byPath } = buildTree(rows);
    return NextResponse.json({ tree, byPath });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST → 标签操作（蓝皮书「层级标签管理」）
// action: rename（重命名，子层级跟随） | merge（合并到另一标签，存在则去重） | delete | assign（批量关联笔记）
export async function POST(req: NextRequest) {
  try {
    const owner = requireAdminEnv();
    const body = (await req.json()) as {
      action?: 'rename' | 'merge' | 'delete' | 'assign';
      from?: string;
      to?: string;
      paths?: string[];
    };
    const sb = supabaseAdmin();
    const affected: TagRow[] = [];
    const affectedPaths = new Set<string>();

    // rename/merge/delete：找出含该标签（或其子层级）的所有行，重写数组
    if (body.action === 'rename' || body.action === 'merge' || body.action === 'delete') {
      const from = body.from?.trim().replace(/^#/, '');
      if (!from) return NextResponse.json({ error: '缺少 from 标签' }, { status: 400 });
      if (body.action !== 'delete' && !body.to?.trim()) {
        return NextResponse.json({ error: '缺少目标标签 to' }, { status: 400 });
      }
      const { data, error } = await sb
        .from('obsidian_metadata')
        .select('id, file_path, tags')
        .eq('user_id', owner)
        // cs = 数组包含：命中 from 本体；子层级（from/xxx）在内存里匹配（pg 数组无前缀匹配操作符，量级个人可接受）
        .filter('tags', 'cs', `{${JSON.stringify(from).replace(/"/g, '\\"')}}`);
      if (error) throw new Error(error.message);

      const to = body.to?.trim().replace(/^#/, '');
      for (const row of (data ?? []) as (TagRow & { id: string })[]) {
        const nextTags = (row.tags ?? [])
          .map((t) => {
            if (t === from) return body.action === 'rename' ? to : body.action === 'merge' ? to : null;
            if (t.startsWith(`${from}/`)) {
              const suffix = t.slice(from.length);
              if (body.action === 'rename') return `${to}${suffix}`;
              if (body.action === 'merge') return `${to}${suffix}`;
              return null; // delete：子层级一并删除
            }
            return t;
          })
          .filter((t, i, arr): t is string => !!t && arr.indexOf(t) === i); // 去重 + 去空
        await sb.from('obsidian_metadata').update({ tags: nextTags }).eq('id', row.id);
        affectedPaths.add(row.file_path);
        affected.push({ file_path: row.file_path, tags: nextTags });
      }
      return NextResponse.json({ ok: true, changed: affectedPaths.size });
    }

    // assign：给一批笔记追加标签（批量关联）
    if (body.action === 'assign') {
      const tag = body.to?.trim().replace(/^#/, '');
      const paths = (body.paths ?? []).filter(Boolean);
      if (!tag || paths.length === 0) return NextResponse.json({ error: '缺少标签或笔记列表' }, { status: 400 });
      for (const path of paths) {
        const { data: row } = await sb
          .from('obsidian_metadata')
          .select('id, tags')
          .eq('user_id', owner)
          .eq('file_path', path)
          .maybeSingle();
        // 未同步过的笔记元数据不存在：跳过并提示用户先同步
        if (!row) continue;
        const tags = ((row.tags as string[]) ?? []).includes(tag)
          ? (row.tags as string[])
          : [...((row.tags as string[]) ?? []), tag];
        await sb.from('obsidian_metadata').update({ tags }).eq('id', (row as { id: string }).id);
        affectedPaths.add(path);
      }
      return NextResponse.json({ ok: true, changed: affectedPaths.size });
    }

    return NextResponse.json({ error: '未知 action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
