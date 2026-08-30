/**
 * 每日一句知识点：语文文言文 / 数学公式 / 英语高频词三科轮换。
 * 内置精选小库（条目为公有领域古诗文与事实性公式/词汇，无版权问题），
 * 按北京日期轮换——同一天全站一致，次日自动换新，零接口零依赖。
 * 注意：与移动端 jayEggs.ts 类似的「日期哈希轮换」思路，但独立数据源。
 */

export type KdSubject = '语文' | '数学' | '英语';

export interface KnowledgeEntry {
  subject: KdSubject;
  tag: string; // 学科子类：文言文 / 公式 / 高频词
  text: string; // 主体内容：原句 / 公式 / 单词+词性
  note: string; // 一句话提示：出处+简译 / 适用场景 / 搭配用法
}

const CHINESE: KnowledgeEntry[] = [
  { subject: '语文', tag: '文言文', text: '学而不思则罔，思而不学则殆。', note: '《论语·为政》——只学不思会迷惘，只思不学会疲怠' },
  { subject: '语文', tag: '文言文', text: '三人行，必有我师焉。择其善者而从之，其不善者而改之。', note: '《论语·述而》——向人学习的两个方向' },
  { subject: '语文', tag: '文言文', text: '富贵不能淫，贫贱不能移，威武不能屈。', note: '《孟子·滕文公下》——大丈夫的三条标准' },
  { subject: '语文', tag: '文言文', text: '生于忧患，死于安乐。', note: '《孟子·告子下》——忧患使人生存发展，安逸享乐使人萎靡衰亡' },
  { subject: '语文', tag: '文言文', text: '路漫漫其修远兮，吾将上下而求索。', note: '屈原《离骚》——前路漫长，仍要不断求索' },
  { subject: '语文', tag: '文言文', text: '亦余心之所善兮，虽九死其犹未悔。', note: '屈原《离骚》——为心中所善，九死不悔' },
  { subject: '语文', tag: '文言文', text: '山不厌高，海不厌深。周公吐哺，天下归心。', note: '曹操《短歌行》——求贤若渴的胸襟' },
  { subject: '语文', tag: '文言文', text: '采菊东篱下，悠然见南山。', note: '陶渊明《饮酒·其五》——无意中见山，物我两忘的悠然' },
  { subject: '语文', tag: '文言文', text: '落霞与孤鹜齐飞，秋水共长天一色。', note: '王勃《滕王阁序》——动静结合、天水一色的名对' },
  { subject: '语文', tag: '文言文', text: '不以物喜，不以己悲。', note: '范仲淹《岳阳楼记》——不因外物与个人得失而或喜或悲' },
  { subject: '语文', tag: '文言文', text: '先天下之忧而忧，后天下之乐而乐。', note: '范仲淹《岳阳楼记》——忧乐观，也是全文文眼' },
  { subject: '语文', tag: '文言文', text: '醉翁之意不在酒，在乎山水之间也。', note: '欧阳修《醉翁亭记》——醉翁情趣所在，醉是表象' },
];

const MATH: KnowledgeEntry[] = [
  { subject: '数学', tag: '公式', text: 'sin²θ + cos²θ = 1', note: '同角三角函数基本关系——消元降次的万能钥匙' },
  { subject: '数学', tag: '公式', text: 'sin(α±β) = sinα·cosβ ± cosα·sinβ', note: '和角公式——正弦异名同号' },
  { subject: '数学', tag: '公式', text: 'cos2α = cos²α − sin²α = 2cos²α − 1 = 1 − 2sin²α', note: '二倍角——三种形态，降幂公式由它变形而来' },
  { subject: '数学', tag: '公式', text: 'Sₙ = n(a₁ + aₙ) / 2', note: '等差数列求和——倒序相加的成果，类比梯形面积记忆' },
  { subject: '数学', tag: '公式', text: 'Sₙ = a₁(1 − qⁿ) / (1 − q)　(q ≠ 1)', note: '等比数列求和——错位相减法结论；注意 q = 1 时 Sₙ = na₁' },
  { subject: '数学', tag: '公式', text: "(xⁿ)' = n·xⁿ⁻¹　(sin x)' = cos x　(eˣ)' = eˣ　(ln x)' = 1/x", note: '四大基本导数——导数大题的基石' },
  { subject: '数学', tag: '公式', text: "(uv)' = u'v + uv'", note: '乘积求导法则——顺序无关，各导各的再交换' },
  { subject: '数学', tag: '公式', text: 'a/sin A = b/sin B = c/sin C = 2R', note: '正弦定理——边角互化，R 为外接圆半径' },
  { subject: '数学', tag: '公式', text: 'c² = a² + b² − 2ab·cos C', note: '余弦定理——已知两边夹角求第三边；勾股定理是其特例' },
  { subject: '数学', tag: '公式', text: 'x²/a² + y²/b² = 1（a > b > 0），e = c/a', note: '椭圆标准方程与离心率——e 越小越接近圆' },
  { subject: '数学', tag: '公式', text: 'd = |Ax₀ + By₀ + C| / √(A² + B²)', note: '点到直线距离——代入即可，注意绝对值' },
  { subject: '数学', tag: '公式', text: 'a + b ≥ 2√(ab)（a, b > 0，当且仅当 a = b 取等）', note: '基本不等式——求最值三步：正、定、等' },
];

const ENGLISH: KnowledgeEntry[] = [
  { subject: '英语', tag: '高频词', text: 'absorb v. 吸收；使专注', note: 'be absorbed in（doing）sth. 全神贯注于——阅读理解高频搭配' },
  { subject: '英语', tag: '高频词', text: 'adequate adj. 足够的；胜任的', note: 'adequate for sb. to do sth. 足以胜任' },
  { subject: '英语', tag: '高频词', text: 'ambition n. 抱负；雄心', note: 'have great ambition 胸怀大志；形容词 ambitious' },
  { subject: '英语', tag: '高频词', text: 'anxiety n. 焦虑', note: 'feel anxious about 对……感到焦虑——完形情绪词' },
  { subject: '英语', tag: '高频词', text: 'approach n. 方法；v. 接近', note: 'an approach to doing sth. 做某事的方法——一词两性' },
  { subject: '英语', tag: '高频词', text: 'appreciate v. 感激；欣赏；增值', note: 'I would appreciate it if… 写作万能客套句' },
  { subject: '英语', tag: '高频词', text: 'appropriate adj. 恰当的', note: 'be appropriate for 适合于——反义 inappropriate' },
  { subject: '英语', tag: '高频词', text: 'assume v. 假定；承担', note: 'assume responsibility 承担责任；别与 assure（保证）混淆' },
  { subject: '英语', tag: '高频词', text: 'attain v. 达到；获得', note: 'attain one\'s goal 达到目标——近义 achieve' },
  { subject: '英语', tag: '高频词', text: 'authentic adj. 真实的；正宗的', note: 'an authentic experience 真实的经历——读后续写质感词' },
  { subject: '英语', tag: '高频词', text: 'available adj. 可获得的；有空的', note: 'be available to do sth. 有空做某事' },
  { subject: '英语', tag: '高频词', text: 'aware adj. 意识到的', note: 'be aware of 意识到——名词 awareness（意识）' },
];

const POOLS: Record<KdSubject, KnowledgeEntry[]> = { 语文: CHINESE, 数学: MATH, 英语: ENGLISH };
const SUBJECTS: KdSubject[] = ['语文', '数学', '英语'];

/** 按北京日期轮换：学科 = 天数取模，条目 = 同科内错开——同日全站一致，次日换新 */
export function getDailyKnowledge(now: Date = new Date()): KnowledgeEntry {
  const bjDays = Math.floor((now.getTime() + 8 * 3600 * 1000) / 86400000);
  const subject = SUBJECTS[bjDays % SUBJECTS.length];
  const pool = POOLS[subject];
  return pool[Math.floor(bjDays / SUBJECTS.length) % pool.length];
}
