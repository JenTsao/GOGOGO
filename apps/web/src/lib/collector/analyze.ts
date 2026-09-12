// 素材打分（Collector 的 AI 层）：把「新闻价值」评分整体反转成「高考适配度」评分。
// 这是接入 Horizon 采集能力时最关键的改造——原逻辑按新闻重要性打分，
// 而高考选材价值与新闻价值高度错位甚至相反（见下表），不改这一步，
// 系统跑得很欢但产出的全是不能命题的废素材。
import { chatCompletion, parseJsonLoose, LLM_PROVIDERS } from '@/lib/llm';
import { TOPICS } from './sources';

/** 供调用方判断：未配 LLM Key 时走「只采集不打分」降级，绝不因打分失败丢素材（时间不可补偿） */
export function llmConfigured(): boolean {
  const name = process.env.LLM_PROVIDER ?? 'deepseek';
  const info = LLM_PROVIDERS[name] ?? LLM_PROVIDERS.deepseek;
  return Boolean(process.env[info.apiKeyEnv]);
}

export interface MaterialScore {
  score: number;
  reason: string;
  summary: string;
  tags: string[];
}

export interface ParsedTags {
  topic?: string;
  genre?: string;
  difficulty?: string;
  words?: number;
  risk?: string;
  form?: string;
}

const TAG_KEYS = ['topic', 'genre', 'difficulty', 'words', 'risk', 'form'] as const;

/** 把 ['topic:科技前沿','words:385'] 解析成结构化字段；格式不符的忽略 */
export function parseTags(tags: string[]): ParsedTags {
  const out: ParsedTags = {};
  for (const t of tags ?? []) {
    if (typeof t !== 'string') continue;
    const idx = t.indexOf(':');
    if (idx <= 0) continue;
    const k = t.slice(0, idx).trim().toLowerCase();
    const v = t.slice(idx + 1).trim();
    if (!(TAG_KEYS as readonly string[]).includes(k)) continue;
    if (k === 'words') {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) out.words = n;
    } else {
      (out as Record<string, string>)[k] = v;
    }
  }
  return out;
}

const SYSTEM = `你是高考英语命题研究专家，负责评估一篇英文文章是否适合被改编为高考英语试题素材。

【第一原则：这不是新闻价值评估】
不要按「新闻重要性」打分。以下错位是最常见的失败模式：
| 文章类型 | 新闻价值 | 高考选材价值 |
|---|---|---|
| 突发政治事件、战争、灾难、名人八卦 | 9-10 | 0-2（几乎不可能命题） |
| 小镇旅游手册、生活指南、个人博客 | 2-3 | 7-9（占高考选材约 26%） |
| 科普小品（睡眠、咖啡、园艺、动物行为） | 4-5 | 7-9（专业刊物 16% 的主力） |
| 严肃媒体的社会议题深度报道 | 8-9 | 6-8（严肃媒体 45% 的主力） |

【评分标准 0-10】
- 9-10 理想：话题普适、结构清晰、信息有层次、有推理空间、语言地道但不晦涩、无文化背景门槛
- 7-8 优质：需轻度改编（篇幅裁剪、少量生词处理）
- 5-6 可用：需中等改编（结构调整、较多生词替换、背景补全）
- 3-4 勉强：话题偏冷或结构松散，改编成本高
- 0-2 不适合：触发下方任一否决项

【一票否决（直接 0-2）】
政治敏感、宗教、暴力、色情、争议价值观；时效性过强（突发事件，明年即失效）；
商业广告、营销软文、产品评测；学术性过强（大量术语/公式）；纯观点输出缺乏信息层次。

【输出 JSON】
{"score": 0-10 数字, "reason": "一句话，指出最主要加分项或扣分项", "summary": "60 字内中文摘要：讲什么 + 可能命题切入点", "tags": ["topic:X","genre:X","difficulty:X","words:整数","risk:X","form:X"]}
tags 六类必填，每类一个：
- topic 从八类中选：${TOPICS.join(' / ')}
- genre：说明文 / 记叙文 / 议论文 / 应用文 / 新闻报道
- difficulty：easy / medium / hard（以高考为参照，非母语者视角）
- words：正文词数整数估算
- risk：none / 政治敏感 / 宗教 / 暴力 / 争议价值观 / 文化偏见
- form：阅读 / 完形 / 语法填空（最适合改编成的题型）

【特别注意】
1. 旅游手册、生活指南类不要因「不严肃」压分——此类占选材约 26%，判据是语言地道性与信息完整性。
2. 篇幅是硬指标但不是否决项（阅读 250-400 词最佳），过长在 reason 说明即可，不要因此压到低分。
3. 推理空间是重要加分项；平铺直叙读完即止的文章，即使语言简单价值也有限。
4. 复杂句不是减分项——高考原文本就保留定语从句/分词状语/插入语，那是改编环节处理的，不是此处淘汰的。
5. 内容可能被截断，信息不足时给保守分，不要臆测全文。

只输出 JSON。`;

/**
 * 单篇打分。返回 null = 无法判定（解析失败），调用方应跳过该条而非写入脏数据。
 */
export async function analyzeMaterial(
  title: string,
  body: string,
  sourceName: string
): Promise<MaterialScore | null> {
  const text = body.slice(0, 8000); // ≈4000 token，够判断且不至于撑爆预算
  const raw = await chatCompletion(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `来源：${sourceName}\n标题：${title}\n\n正文：\n${text}`,
      },
    ],
    { temperature: 0.3, maxTokens: 2048 }
  );
  const json = parseJsonLoose(raw);
  if (!json) return null;

  const score = Number(json.score);
  if (!Number.isFinite(score)) return null;

  return {
    score: Math.max(0, Math.min(10, score)),
    reason: String(json.reason ?? '').slice(0, 300),
    summary: String(json.summary ?? '').slice(0, 300),
    tags: Array.isArray(json.tags) ? json.tags.map(String).slice(0, 12) : [],
  };
}
