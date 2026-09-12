// 命题 Agent 体系·常量层：所有「将来可能要调的清单」抽到这里（Prompt 与数据分离）。
// 改清单 = 改数据不动 prompt 模板代码；registry 的 prompt 模板用这些常量组装。

/** 英语阅读八类母题（主类） */
export const TOPIC_CATEGORIES = [
  '科技前沿',
  '自然环境',
  '社会文化',
  '个人成长',
  '教育学习',
  '健康生活',
  '历史人文',
  '艺术娱乐',
] as const;

/** 英语文体 */
export const ENGLISH_GENRES = ['说明文', '记叙文', '议论文', '应用文', '新闻报道'] as const;

/** 风险标签：Filter 必检清单 */
export const RISK_FLAGS = [
  '政治敏感',
  '宗教',
  '暴力',
  '性',
  '争议价值观',
  '商业广告倾向',
  '文化偏见',
] as const;

/** 英语阅读题的五个能力维度（ItemWriter 四题选四，主旨与推理优先） */
export const READING_SKILL_DIMENSIONS = [
  '细节理解（定位 + 同义转述）',
  '推理判断（言外之意、因果推断）',
  '主旨大意 / 标题概括 / 写作目的',
  '词义猜测（划线词/短语）',
  '观点态度（作者立场、语气判断）',
] as const;

/** 英语干扰项六型（每个错误选项必须归属其一并在解析标注） */
export const ENGLISH_DISTRACTOR_TYPES = [
  '张冠李戴',
  '以偏概全',
  '无中生有',
  '偷换概念',
  '过度推断',
  '答非所问',
] as const;

/** 语文论述类干扰项九型 */
export const CHINESE_DISTRACTOR_TYPES = [
  '范围失当',
  '程度失当',
  '时态错位',
  '条件替换',
  '因果倒置',
  '主次颠倒',
  '概念偷换',
  '无中生有',
  '推断过度',
] as const;

/** 文言文内容概括题错误项类型 */
export const CLASSICAL_ERROR_TYPES = [
  '时序颠倒',
  '张冠李戴',
  '无中生有',
  '曲解文意',
  '以偏概全',
] as const;

/** 各题型目标字数（Adapter 用） */
export const GAOKAO_WORD_COUNTS: Record<string, string> = {
  '阅读理解': '250-400',
  '完形填空': '250-320',
  '语法填空': '180-220',
};

/** 数学错因 → 变式策略映射（Agent 8 的核心配置） */
export const MATH_ERROR_STRATEGIES: { error: string; strategy: string }[] = [
  { error: '概念理解错误', strategy: '同考点、更换情境、保留概念内核' },
  { error: '运算失误', strategy: '同题改数据，但设置易错数据（特殊值、符号陷阱）' },
  { error: '方法选择错误', strategy: '同题，但改变条件使原方法失效，逼迫换法' },
  { error: '读题/转化失败', strategy: '改变表述方式（几何↔代数↔向量互译）' },
  { error: '分类讨论遗漏', strategy: '设计必须分类的参数题' },
  { error: '新定义题不适应', strategy: '仿照高考「现场定义新概念」模式出题' },
];

/** 数学新定义题型三问模板（近年趋势） */
export const NEW_DEFINITION_TEMPLATE = [
  '第 1 问：代入验证（送分，确保学生能入门）',
  '第 2 问：利用新定义完成一个中等推理',
  '第 3 问：与已有知识综合，考查迁移',
] as const;

/** 高考选材适配度评分锚点（Filter 用） */
export const FIT_SCORE_ANCHORS = [
  '90-100：话题普适、结构清晰、有明确信息层次和推理空间、无文化背景门槛',
  '70-89：可用，但需较大幅度改编（篇幅/生词/背景）',
  '50-69：勉强，话题偏冷或结构松散',
  '<50：不适合（话题过专、时效性过强、情绪化、广告感重）',
] as const;
