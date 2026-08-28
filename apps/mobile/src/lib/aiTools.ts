// L4 跨模块调度：6 大核心工具（蓝皮书第四章）
// 写操作（addTask/setReminder）必须经确认卡片 → aiStore.confirmToolCall 才执行
import { ToolDef } from './llm';
import { useTaskStore } from '@/store/taskStore';
import { useReminderStore, localDateStr } from '@/store/reminderStore';
import { useFocusStore } from '@/store/focusStore';
import { useSandboxStore } from '@/store/sandboxStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';

export type AiToolName =
  | 'addTask'
  | 'setReminder'
  | 'searchWeb'
  | 'exportNote'
  | 'queryStats'
  | 'correctCode';

export const TOOL_SCHEMAS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'addTask',
      description: '添加任务到「今日三件事」或「后备箱」',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '任务内容' },
          status: { type: 'string', enum: ['top3', 'backlog'], description: 'top3=今日三件事，backlog=后备箱' },
        },
        required: ['content', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setReminder',
      description: '创建自定义日期提醒（如：9月10日交数学作业）',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期，YYYY-MM-DD 格式' },
          content: { type: 'string', description: '提醒内容' },
        },
        required: ['date', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchWeb',
      description: '联网搜索外部信息（如分数线、考纲变动），返回摘要',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exportNote',
      description: '导出/编译笔记为复习 HTML（可另存 PDF）、Anki 卡片包或纯文本大纲，返回下载链接',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: '笔记文件名或路径（知识库中已下载过的笔记）；不传则默认最近下载的一篇' },
          type: { type: 'string', enum: ['pdf', 'anki', 'outline'], description: 'pdf=A4打印HTML，anki=Anki卡片包，outline=纯文本大纲' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queryStats',
      description: '查询专注计时统计（今日/本周专注分钟数与次数）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'correctCode',
      description: '读取代码沙盒最近片段，辅助诊断修复报错（需用户补充报错信息）',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export const WRITE_TOOLS: ReadonlySet<string> = new Set(['addTask', 'setReminder']);

// 确认卡片文案：把参数翻译成人话
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'addTask':
      return `添加任务「${args.content ?? ''}」到${args.status === 'backlog' ? '后备箱' : '今日三件事'}`;
    case 'setReminder':
      return `创建提醒：${args.date ?? ''} ${args.content ?? ''}`;
    default:
      return `执行 ${name}`;
  }
}

interface ToolResult {
  ok: boolean;
  text: string;
}

// 工具执行：只操作 store / 外部 API，不碰 aiStore（避免循环依赖），结果由 aiStore 上屏
export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'addTask': {
        const content = String(args.content ?? '').trim();
        if (!content) return { ok: false, text: '任务内容为空，未添加' };
        const status = args.status === 'backlog' ? 'backlog' : 'top3';
        useTaskStore.getState().addTask(content, status);
        return {
          ok: true,
          text: `✅ 已${status === 'backlog' ? '放入后备箱' : '加入今日三件事'}：「${content}」`,
        };
      }
      case 'setReminder': {
        const content = String(args.content ?? '').trim();
        const date = String(args.date ?? '').trim();
        if (!content || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return { ok: false, text: '提醒参数不完整（需要日期 YYYY-MM-DD 和内容）' };
        }
        useReminderStore.getState().addReminder(date, content);
        return { ok: true, text: `✅ 已创建提醒：${date} ${content}` };
      }
      case 'searchWeb': {
        const query = String(args.query ?? '').trim();
        if (!query) return { ok: false, text: '缺少搜索关键词' };
        const { tavilyKey } = useSettingsStore.getState();
        if (!tavilyKey) return { ok: false, text: '未配置 Tavily Key（在「我的」填写后可用联网搜索）' };
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query, max_results: 3, include_answer: true }),
        });
        if (!res.ok) return { ok: false, text: `搜索失败（HTTP ${res.status}）` };
        const data = (await res.json()) as {
          answer?: string;
          results?: { title: string; url: string; content: string }[];
        };
        const lines = (data.results ?? [])
          .slice(0, 3)
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.content.slice(0, 120)}…\n   ${r.url}`);
        return {
          ok: true,
          text: `🔍 「${query}」搜索结果：\n${data.answer ? `摘要：${data.answer}\n\n` : ''}${lines.join('\n') || '无结果'}`,
        };
      }
      case 'exportNote': {
        // 编译在管理台服务端完成：拉取 GitHub 原文 → 产物上传 Supabase Storage → 返回下载链接
        const { webApiUrl, accessKey } = useSettingsStore.getState();
        if (!webApiUrl || !accessKey) {
          return { ok: false, text: '导出需要云端：请先在「我的」配置管理台地址 + 访问密钥' };
        }
        const cache = useKnowledgeStore.getState().cache;
        const paths = Object.keys(cache);
        if (paths.length === 0) {
          return { ok: false, text: '知识库还没有已下载的笔记。请先在弹药库→知识库中下载要导出的笔记，再让我导出。' };
        }
        // 定位目标笔记：按传入名称后缀/包含匹配；未传时若只有一篇则直接用
        const wanted = String(args.note ?? '').trim();
        let target: string | undefined;
        if (wanted) {
          target = paths.find((p) => p === wanted || p.endsWith(`/${wanted}`) || p.endsWith(wanted));
          if (!target) target = paths.find((p) => p.includes(wanted));
        } else if (paths.length === 1) {
          target = paths[0];
        }
        if (!target) {
          const list = paths.slice(-8).map((p) => `· ${p}`).join('\n');
          return { ok: false, text: `找到 ${paths.length} 篇已下载笔记，请说明要导出哪一篇（如“导出导数.md”）：\n${list}` };
        }
        const type = args.type === 'anki' || args.type === 'outline' ? args.type : 'pdf';
        const res = await fetch(`${webApiUrl.replace(/\/+$/, '')}/api/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
          body: JSON.stringify({ paths: [target], type }),
        });
        const data = (await res.json()) as { downloadUrl?: string; error?: string; files?: number; warn?: string };
        if (!res.ok || !data.downloadUrl) {
          return { ok: false, text: `导出失败：${data.error ?? `HTTP ${res.status}`}` };
        }
        const typeName = type === 'anki' ? 'Anki 卡片包' : type === 'outline' ? '纯文本大纲' : 'A4 打印 HTML（浏览器打开→Ctrl+P 存为 PDF）';
        return {
          ok: true,
          text: `📤 「${target}」已编译为${typeName}${data.warn ? `（⚠️ ${data.warn}）` : ''}：\n${data.downloadUrl}`,
        };
      }
      case 'queryStats': {
        const sessions = useFocusStore.getState().sessions;
        const today = localDateStr(new Date());
        const weekAgo = new Date(Date.now() - 7 * 86400000);
        const minOf = (list: typeof sessions) => Math.round(list.reduce((s, x) => s + x.duration, 0) / 60);
        const todayList = sessions.filter((s) => localDateStr(new Date(s.endedAt)) === today);
        const weekList = sessions.filter((s) => new Date(s.endedAt) >= weekAgo);
        if (sessions.length === 0) return { ok: true, text: '📊 还没有专注记录，进入心流模式开始第一次专注吧！' };
        return {
          ok: true,
          text: `📊 专注统计：今日 ${minOf(todayList)} 分钟（${todayList.length} 次）· 近 7 天 ${minOf(weekList)} 分钟（${weekList.length} 次）`,
        };
      }
      case 'correctCode': {
        const snippet = useSandboxStore.getState().snippets[0];
        if (!snippet) {
          return { ok: false, text: '沙盒中还没有已保存的片段。请先在弹药库保存代码，再把报错信息发给我。' };
        }
        return {
          ok: true,
          text: `🛠 已读取最近片段「${snippet.name}」（${snippet.code.split('\n').length} 行）。请把完整报错信息粘贴到对话中，我来诊断修复。`,
        };
      }
      default:
        return { ok: false, text: `未知工具：${name}` };
    }
  } catch (e) {
    return { ok: false, text: `工具执行失败：${(e as Error).message}` };
  }
}
