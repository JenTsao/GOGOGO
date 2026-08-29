import { NextRequest, NextResponse } from 'next/server';
import { fetchRawFile } from '@/lib/github';
import { chatCompletion } from '@/lib/llm';
import { isAdminRequest, adminUnauthorized } from '@/lib/access';

export const dynamic = 'force-dynamic';

const MAX_NOTES = 8; // 单次精炼篇数上限：控制 token 成本与延迟
const MAX_CHARS_PER_NOTE = 4000; // 单篇截断：笔记超长时保留开头（知识点密度通常前高后低）

const MERGE_PROMPT = `你是高考复习资料编辑。基于以下多篇 Obsidian 笔记，提炼生成一份「终极复习卡片」Markdown：
- 保留核心公式、结论、易错点
- 合并重复内容，标注来源笔记
- 结尾给出 3-5 条记忆口诀
直接输出 Markdown，不要额外解释。`;

const GRAPH_PROMPT = `你是知识图谱工程师。分析以下多篇 Obsidian 笔记的语义关联，输出一个 Mermaid flowchart 代码块（只输出 mermaid 代码，不要 markdown 围栏）：
- 节点 = 核心概念/知识点，用简洁中文标签
- 边 = 前置/推导/关联关系，边上可标注关系类型
- 最多 20 个节点，避免连线交叉`;
// 只输出 mermaid 代码的原因：客户端直接交给 mermaid.render，围栏会破坏解析

export async function POST(req: NextRequest) {
  // 精炼会消耗 LLM 额度，公开部署时必须鉴权（配置 ADMIN_TOKEN 后强制）
  if (!isAdminRequest(req)) {
    return NextResponse.json(adminUnauthorized(), { status: 401 });
  }
  let body: { paths?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === 'string') : [];
  const mode = body.mode === 'graph' ? 'graph' : 'merge';
  if (paths.length === 0) return NextResponse.json({ error: '请先在文件树勾选至少一篇笔记' }, { status: 400 });
  if (paths.length > MAX_NOTES) return NextResponse.json({ error: `单次最多勾选 ${MAX_NOTES} 篇` }, { status: 400 });

  try {
    // 并发读取原文；单篇超长截断（Promise.all 并发数受 MAX_NOTES 限制，安全）
    const contents = await Promise.all(
      paths.map(async (p) => {
        const text = await fetchRawFile(p).catch(() => '');
        return `【笔记：${p}】\n${text.slice(0, MAX_CHARS_PER_NOTE)}${text.length > MAX_CHARS_PER_NOTE ? '\n…（已截断）' : ''}`;
      })
    );
    const material = contents.join('\n\n---\n\n');
    const text = await chatCompletion(
      [
        { role: 'system', content: mode === 'graph' ? GRAPH_PROMPT : MERGE_PROMPT },
        { role: 'user', content: material },
      ],
      { temperature: mode === 'graph' ? 0.3 : 0.5 }
    );
    return NextResponse.json({ mode, text });
  } catch (e) {
    return NextResponse.json({ error: `精炼失败：${(e as Error).message}` }, { status: 502 });
  }
}
