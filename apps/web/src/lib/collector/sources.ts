// 素材源注册表：纯数据模块，改源 = 改这里，不动采集逻辑。
//
// 选源五条准入标准（新增源前自检，任一不达标就不要加）：
//   ① 原创性：自己采写、有作者署名。聚合站 / 转载站一票否决（下游二手文本语言不地道）
//   ② 编辑规范：有明确编辑部与更正机制
//   ③ 域名资历：运营 5 年以上，或知名机构官网
//   ④ 语言母语度：写作者为英语母语者 / 机构位于英语国家
//   ⑤ 命题史：该源或同类源有过高考选用记录（最硬的一条）
//
// ⚠️ RSS 地址会变。新增或长期未跑后，先访问 /materials 点「验证源」看返回码，
//    非 200 的源替换或删除——坏源不会报错，只会静默少采。

export type MaterialCategory = 'serious-media' | 'professional' | 'lifestyle' | 'tabloid';

export interface SourceDef {
  name: string;
  url: string;
  category: MaterialCategory;
  /** 归属科目：中文源接入后填「语文」，Selector 按科目过滤 */
  subject: string;
}

/**
 * 选材比例配额：来自历年真题选材统计，不是拍脑袋。
 * 没有配额时 NYT 这类高产严肃媒体（日发数百篇）会把 lifestyle 挤到接近零，
 * 而旅游手册 / 生活指南类实际占高考选材约 26%。
 */
export const CATEGORY_QUOTA: Record<MaterialCategory, number> = {
  'serious-media': 45,
  lifestyle: 26,
  professional: 16,
  tabloid: 13,
};

export const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  'serious-media': '严肃媒体',
  professional: '专业刊物',
  lifestyle: '生活信息',
  tabloid: '都市小报',
};

// Tier 1 源：serious-media / professional 里的核心源有实锤高考选用记录
export const MATERIAL_SOURCES: SourceDef[] = [
  // ---- 严肃媒体 45%（NYT/Guardian/BBC/NPR/China Daily 均有真题选用记录）----
  { name: 'Guardian World', url: 'https://www.theguardian.com/world/rss', category: 'serious-media', subject: '英语' },
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'serious-media', subject: '英语' },
  { name: 'NPR National', url: 'https://feeds.npr.org/1001/rss.xml', category: 'serious-media', subject: '英语' },
  { name: 'China Daily', url: 'https://www.chinadaily.com.cn/rss/world_rss.xml', category: 'serious-media', subject: '英语' },
  { name: 'NYT HomePage', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', category: 'serious-media', subject: '英语' },

  // ---- 专业刊物 16%（New Scientist 连续两年入选；Knowable 2025 全国一卷 A 篇）----
  { name: 'New Scientist', url: 'https://www.newscientist.com/feed/home/', category: 'professional', subject: '英语' },
  { name: 'Knowable Magazine', url: 'https://knowablemagazine.org/rss.xml', category: 'professional', subject: '英语' },
  // The Conversation：CC-BY 授权（改编转载无版权风险）+ 学者写给公众，正对「专业刊物」定位
  { name: 'The Conversation', url: 'https://theconversation.com/articles.atom', category: 'professional', subject: '英语' },
  { name: 'Nautilus', url: 'https://nautil.us/feed/', category: 'professional', subject: '英语' },
  { name: 'Aeon', url: 'https://aeon.co/feed.rss', category: 'professional', subject: '英语' },

  // ---- 生活信息 26%（占比第二高却最易漏：旅游手册/生活指南/机构官网）----
  // 2022 全国甲卷 A 篇出自英国卡迪夫旅游手册；2024 新课标I卷 A 篇出自美国公园保护组织官网
  { name: 'Smithsonian Mag', url: 'https://www.smithsonianmag.com/rss/latest_articles/', category: 'lifestyle', subject: '英语' },
  { name: 'Atlas Obscura', url: 'https://www.atlasobscura.com/feeds/latest', category: 'lifestyle', subject: '英语' },
  { name: 'NPS News', url: 'https://www.nps.gov/rss/news.xml', category: 'lifestyle', subject: '英语' },
  { name: 'Guardian Travel', url: 'https://www.theguardian.com/travel/rss', category: 'lifestyle', subject: '英语' },

  // ---- 都市小报 13%（大众化报纸，语言鲜活）----
  { name: 'NY Post', url: 'https://nypost.com/feed/', category: 'tabloid', subject: '英语' },
];

/** 八类母题：与 lib/agents/constants.ts 的 TOPIC_CATEGORIES 保持一致 */
export const TOPICS = [
  '科技前沿',
  '自然环境',
  '社会文化',
  '个人成长',
  '教育学习',
  '健康生活',
  '历史人文',
  '艺术娱乐',
] as const;
