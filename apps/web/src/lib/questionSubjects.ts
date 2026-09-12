// 每日猜题流水线的科目注册表：客户端与服务端共享的纯数据模块。
// 扩展方式：往 QUESTION_SUBJECTS 加一条定义即可 —— 流水线自动执行、/questions 页自动展示。
//
// LLM 输出 JSON 契约（各科目统一，科目差异全部收敛在 questionSpec/systemPrompt 里）：
// {
//   "material": "（仅当外部素材缺失、由 AI 自拟材料时返回原文，否则省略此字段）",
//   "questions": [
//     { "type": "单选", "stem": "…", "options": ["A…", "B…", "C…", "D…"], "answer": "B", "analysis": "…" },
//     { "type": "简答", "stem": "…", "answer": "…", "analysis": "…" },
//     { "type": "作文", "stem": "…", "analysis": "审题立意指导…" }
//   ],
//   "tip": "今日考点点评，60 字内"
// }
// 外部素材时材料原文不入 LLM 返回值（流水线直接落库抓取的原文），避免 LLM 复述失真且省 token。

export interface QuestionSubject {
  subject: string;
  icon: string;
  /** Tavily 全文检索词（needsExternalArticle = true 时使用） */
  searchQuery: string;
  /** 命题素材的媒体偏好，写进命题 prompt 作选材/命题口径说明 */
  sourceLabel: string;
  /** 知识库笔记路径筛选关键词（命中目录/文件名即候选考点锚），空数组 = 不用知识库 */
  noteKeywords: string[];
  /** 无外部素材时是否允许 AI 自拟材料（false = 无素材则跳过该科目） */
  allowAiMaterial: boolean;
  /** 命题人角色设定（system prompt 主体） */
  systemPrompt: string;
  /** 每日题型与题量规格（拼进 user prompt） */
  questionSpec: string;
}

export const QUESTION_SUBJECTS: QuestionSubject[] = [
  {
    subject: '语文',
    icon: '📖',
    searchQuery: '人民日报评论 最新 时评',
    sourceLabel: '人民日报、光明日报、新华社等主流媒体时评文章',
    noteKeywords: ['语文', '作文', '素材', '阅读', '文言'],
    allowAiMaterial: true,
    systemPrompt: `你是高考语文命题研究员，负责从主流媒体时评中押题。命题要求：
- 论述类文本阅读题严格基于材料原文设问，答案必须能在原文中找到依据（信息筛选/论证分析/推断题）
- 干扰项模仿真题风格：偷换概念、以偏概全、强加因果、无中生有
- 作文题贴合材料主题的社会思辨方向，给出审题立意指导
- 全部内容使用简体中文，直接输出 JSON，不输出任何其他文字`,
    questionSpec:
      '基于材料出今日猜题：2 道论述类文本阅读单选题（含 4 选项 + 答案 + 逐项解析）+ 1 道简答题（6 分以内，含参考答案要点）+ 1 道作文题（type 用「作文」，stem 为材料作文要求，analysis 为审题立意指导，无 answer 字段）。',
  },
  {
    subject: '英语',
    icon: '🔤',
    searchQuery: 'English news article China Daily latest',
    sourceLabel: 'China Daily、CGTN、外刊节选等适合高考难度的英语文章（350 词左右为佳）',
    noteKeywords: ['英语', 'english', '语法', '词汇', '完形'],
    allowAiMaterial: true,
    systemPrompt: `你是高考英语命题专家，负责从真实英语语料中押题。命题要求：
- 阅读理解题严格基于材料原文设问：主旨大意 / 细节理解 / 词义猜测 / 推理判断覆盖
- 选项长度与句式模仿真题，干扰项合理
- 题干与选项用英文，解析（analysis）用中文
- 若材料由你自拟，难度对标高考阅读 C/D 篇（生词率 ≤ 3%），350 词左右
- 直接输出 JSON，不输出任何其他文字`,
    questionSpec:
      '基于材料出今日猜题：3 道阅读理解单选题（含 4 个英文选项 + 答案 + 中文解析）+ 1 道 10 空语法填空（type 用「语法填空」，stem 为含 10 个空格的短文，answer 为 "1. word 2. word …" 形式的连续答案，analysis 为逐空考点）。',
  },
];

// 供扩展的说明：新增数学/物理等科目时设 needsExternal 场景不适用——
// allowAiMaterial: true + searchQuery 留空即可跳过外部检索，直接由知识库笔记锚定出题。
