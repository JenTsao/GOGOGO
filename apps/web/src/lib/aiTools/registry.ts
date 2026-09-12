// AI 工具区注册表：客户端与服务端共享的纯数据模块（无副作用，可安全双端 import）
// 扩展方式：往 AI_TOOLS 加一条定义即可 —— /tools 页面卡片、执行面板选项、/api/tools/run 执行
// 三处全部自动生效，无需改任何组件或接口代码。

export interface ToolChoice {
  value: string;
  label: string;
  /** 选中该选项时追加到 system prompt 的指令行（由 /api/tools/run 拼接） */
  promptSuffix?: string;
}

export interface ToolOption {
  key: string;
  label: string;
  /** 第一个为默认选中项 */
  choices: ToolChoice[];
}

export interface AITool {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  systemPrompt: string;
  temperature?: number;
  /** 输入上限（字符），超出服务端静默截断并返回 truncated 标记；默认 12000 */
  maxInputChars?: number;
  options?: ToolOption[];
}

export const TOOL_CATEGORIES = ['笔记加工', '学练辅导', '备考策划'] as const;

export const DEFAULT_MAX_INPUT_CHARS = 12000;

export const AI_TOOLS: AITool[] = [
  // ---------- 笔记加工 ----------
  {
    id: 'polish',
    name: '笔记润色',
    icon: '✍️',
    category: '笔记加工',
    description: '把粗糙的课堂笔记改写成结构化复习笔记',
    inputLabel: '笔记原文',
    inputPlaceholder: '粘贴课堂笔记 / 随手记的要点，越乱没关系，AI 负责整理……',
    systemPrompt: `你是高考复习资料编辑。把用户提供的粗糙笔记改写成一份结构化 Obsidian Markdown 复习笔记：
- 用清晰的标题层级组织内容，核心公式与结论用 $...$ 或代码块标注
- 修正笔误、补全省略的推导步骤，但不得编造笔记中没有的知识点
- 结尾附「## 易错提醒」小节（3 条以内）
直接输出 Markdown，不要额外解释。`,
    temperature: 0.4,
    options: [
      {
        key: 'style',
        label: '笔记风格',
        choices: [
          { value: 'outline', label: '大纲式' },
          { value: 'cornell', label: 'Cornell 式', promptSuffix: '排版采用 Cornell 五栏笔记法：页面分「线索问题」「笔记正文」「底部总结」三个区块（用 Markdown 标题与表格模拟）。' },
          { value: 'qa', label: '问答卡片式', promptSuffix: '排版采用问答卡片式：每个知识点写成「**Q：**…」「**A：**…」的问答对，便于自测。' },
        ],
      },
    ],
  },
  {
    id: 'extract',
    name: '考点提炼',
    icon: '📌',
    category: '笔记加工',
    description: '从材料中提炼考点、高频考法与命题趋势',
    inputLabel: '原始材料',
    inputPlaceholder: '粘贴笔记 / 教材段落 / 试卷原文，AI 提炼其中的考点……',
    systemPrompt: `你是高考命题研究员。分析用户提供的材料，输出 Markdown 考点分析：
- 「## 核心考点」：逐条列出考点，每条标注重要程度（★~★★★）
- 「## 高频考法」：该考点常见的题型与提问角度
- 「## 命题信号」：从材料细节推测可能的出题点
只基于材料内容，不要虚构材料外的考点。直接输出 Markdown。`,
    temperature: 0.3,
    options: [
      {
        key: 'format',
        label: '输出形式',
        choices: [
          { value: 'list', label: '考点清单' },
          { value: 'onepage', label: '一页纸速览', promptSuffix: '压缩成「一页纸速览」：全篇不超过 30 行，只保留最核心的结论与公式，表格优先。' },
        ],
      },
    ],
  },

  // ---------- 学练辅导 ----------
  {
    id: 'quiz',
    name: '智能出题',
    icon: '🧪',
    category: '学练辅导',
    description: '根据材料生成模拟题（含答案与解析）',
    inputLabel: '出题材料',
    inputPlaceholder: '粘贴知识点 / 笔记 / 章节内容，AI 据此命题……',
    systemPrompt: `你是高考命题专家。基于用户提供的材料出题，输出 Markdown 试卷：
- 题目编号连续，题干严谨无歧义，不得超出材料知识范围
- 全部题目出完后，用「---」分隔，另起「## 参考答案与解析」作答
- 解析需说明错项排除理由（选择题）或给分步骤（主观题）`,
    temperature: 0.6,
    maxInputChars: 15000,
    options: [
      {
        key: 'type',
        label: '题型',
        choices: [
          { value: 'mc', label: '选择题 ×5', promptSuffix: '共 5 道单项选择题，每题 4 个选项。' },
          { value: 'subjective', label: '主观题 ×3', promptSuffix: '共 3 道主观题（解答/简答/论述），按高考评分标准写解析。' },
          { value: 'mixed', label: '混合小卷', promptSuffix: '出一份混合小卷：3 道选择题 + 2 道主观题，标注建议用时与分值。' },
        ],
      },
      {
        key: 'difficulty',
        label: '难度',
        choices: [
          { value: 'basic', label: '基础巩固', promptSuffix: '难度定位：基础巩固，考查概念辨析与直接应用。' },
          { value: 'exam', label: '高考标准', promptSuffix: '难度定位：高考真题标准，考查综合运用。' },
          { value: 'hard', label: '挑战压轴', promptSuffix: '难度定位：压轴题水平，考查多知识点综合与迁移。' },
        ],
      },
    ],
  },
  {
    id: 'explain',
    name: '概念讲解',
    icon: '💡',
    category: '学练辅导',
    description: '费曼式讲解概念，从直觉到本质',
    inputLabel: '要理解的概念 / 题目',
    inputPlaceholder: '输入概念名称，或粘贴不理解的知识点与疑问……',
    systemPrompt: `你是擅长费曼学习法的理科老师。讲解用户提出的概念或问题，输出 Markdown：
- 从生活直觉或类比切入，再给出严格定义
- 关键公式用 $...$ 标注并逐项解释含义
- 用「## 一句话总结」收尾，再用「## 常见误解」列出 2-3 个易混淆点
语言口语化，禁止堆砌术语。`,
    temperature: 0.5,
    options: [
      {
        key: 'depth',
        label: '讲解深度',
        choices: [
          { value: 'quick', label: '3 分钟快懂', promptSuffix: '篇幅控制在 300 字以内，只讲主干。' },
          { value: 'system', label: '系统精讲' },
          { value: 'deep', label: '刨根问底', promptSuffix: '额外深入：讲清概念的来龙去脉、教科书不写的推导动机与边界条件。' },
        ],
      },
    ],
  },
  {
    id: 'diagnose',
    name: '解题诊断',
    icon: '🔍',
    category: '学练辅导',
    description: '分析自己的解题过程，定位思维漏洞',
    inputLabel: '题目 + 你的解题过程',
    inputPlaceholder: '粘贴题目和你的完整解题过程（包括卡住的地方），AI 帮你找漏洞……',
    systemPrompt: `你是解题教练。用户会给出题目与其解题过程（可能存在错误或卡壳）。输出 Markdown 诊断报告：
- 「## 过程回放」：逐步骤判断对错，用 ✅/❌/⚠️ 标记
- 「## 卡点定位」：指出第一个出错的步骤与出错的心理原因（概念不清/审题偏差/计算失误/方法选择错误）
- 「## 正确思路」：给出完整正确解法（保持用户已正确的步骤，从出错处纠偏）
- 「## 举一反三」：出 1 道同源变式题（附答案，折叠在 details 标签内）`,
    temperature: 0.4,
  },

  // ---------- 备考策划 ----------
  {
    id: 'plan',
    name: '复习计划',
    icon: '📅',
    category: '备考策划',
    description: '生成可执行的周复习计划',
    inputLabel: '你的情况',
    inputPlaceholder: '例如：距高考 90 天，数学 90 分卡在导数大题，物理电磁学薄弱，每天可自主支配 3 小时……',
    systemPrompt: `你是高考备考规划师。根据用户描述的剩余时间、目标与薄弱点，生成 Markdown 周计划：
- 「## 诊断」：3 句话概括现状与优先级
- 「## 本周计划」：表格（时段/任务/目标产出），任务必须具体到章节与题量，预留弹性缓冲
- 「## 执行建议」：3 条以内，可落地
不编造用户未提及的科目信息。`,
    temperature: 0.5,
    maxInputChars: 4000,
  },
  {
    id: 'memorize',
    name: '记忆加工',
    icon: '🧠',
    category: '备考策划',
    description: '把枯燥知识点变成口诀、联想与对比表',
    inputLabel: '要记忆的内容',
    inputPlaceholder: '粘贴容易忘、易混淆的知识点集合……',
    systemPrompt: `你是记忆法专家。把用户提供的知识点加工成好记的形态，输出 Markdown：
- 「## 口诀」：为成组内容编押韵口诀或首字记忆法
- 「## 联想链」：用荒诞但牢固的图像联想串联
- 「## 易混对比」：易混淆项用表格对比（维度自选，突出差异）
- 「## 自测」：3 个填空式自测点（附答案）`,
    temperature: 0.8,
  },
];

export function getTool(id: string): AITool | undefined {
  return AI_TOOLS.find((t) => t.id === id);
}

export function toolsByCategory(category: string): AITool[] {
  return AI_TOOLS.filter((t) => t.category === category);
}

/** 工具 system prompt + 用户选项（promptSuffix 依序追加）→ 最终 system prompt */
export function buildSystemPrompt(tool: AITool, options?: Record<string, string>): string {
  let prompt = tool.systemPrompt;
  for (const opt of tool.options ?? []) {
    const chosen = options?.[opt.key] ?? opt.choices[0]?.value;
    const choice = opt.choices.find((c) => c.value === chosen) ?? opt.choices[0];
    if (choice?.promptSuffix) prompt += `\n${choice.promptSuffix}`;
  }
  return prompt;
}

// ---------- 本地历史记录（框架能力：每次运行自动留痕，localStorage 持久化） ----------

export interface ToolRun {
  id: string;
  toolId: string;
  toolName: string;
  icon: string;
  /** 输入摘要（截断到 500 字符） */
  input: string;
  /** 完整输出 Markdown */
  output: string;
  at: number;
}

export const TOOL_HISTORY_KEY = 'gk_ai_tools_history';
export const TOOL_HISTORY_LIMIT = 30;
const INPUT_SNIPPET_CHARS = 500;

export function loadToolHistory(): ToolRun[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TOOL_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ToolRun[]) : [];
  } catch {
    return [];
  }
}

export function saveToolRun(tool: AITool, input: string, output: string): ToolRun[] {
  const run: ToolRun = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolId: tool.id,
    toolName: tool.name,
    icon: tool.icon,
    input: input.slice(0, INPUT_SNIPPET_CHARS),
    output,
    at: Date.now(),
  };
  const next = [run, ...loadToolHistory()].slice(0, TOOL_HISTORY_LIMIT);
  try {
    window.localStorage.setItem(TOOL_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // 存储满/隐私模式：历史是增值能力，失败不影响主流程
  }
  return next;
}

export function clearToolHistory(): void {
  try {
    window.localStorage.removeItem(TOOL_HISTORY_KEY);
  } catch {
    // 忽略
  }
}
