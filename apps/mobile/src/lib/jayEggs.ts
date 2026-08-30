/**
 * 周杰伦彩蛋：文案全部为「歌名梗」原创句——歌名仅作文化引用，
 * 句子本身自创，不引用任何歌词原文（版权红线）。
 */

// 通用氛围句池：心流界面 / 隐藏歌单随机取用
const JAY_LINES: string[] = [
  '《晴天》会过去，题也会做完',
  '《简单爱》学习：一道一道来，不贪多',
  '《蜗牛》的路线：慢慢来，比较快',
  '《夜曲》留给深夜，《晴天》留给早读',
  '《以父之名》式专注：安静，但强大',
  '累了就想想《稻香》——简单一点，再出发',
  '《告白气球》都需要勇气，考场也一样',
  '《一路向北》不如一路向前',
  '《最伟大的作品》都从第一页开始',
  '《青花瓷》要一笔一笔描，错题要一道一道磨',
];

let lastIdx = -1;

/** 取下一句：避免与上一句重复，制造「换一句」的手感 */
export function nextJayLine(): string {
  let i = Math.floor(Math.random() * JAY_LINES.length);
  if (JAY_LINES.length > 1 && i === lastIdx) i = (i + 1) % JAY_LINES.length;
  lastIdx = i;
  return JAY_LINES[i];
}

// 特定日期彩蛋（MM-DD）：生日与专辑发行日，命中才显示，日常不可见
const JAY_DATES: Record<string, string> = {
  '01-18': '🎂 今天是周杰伦生日，戴上耳机开工吧',
  '08-03': '🌾 《七里香》发行纪念日——这个夏天，属于你',
  '09-14': '🎹 《范特西》发行日——把想象力的档位拉满',
};

/** 当天是否命中日期彩蛋；未命中返回 null（问候语回退常规逻辑） */
export function jayEggForToday(d: Date = new Date()): string | null {
  const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return JAY_DATES[key] ?? null;
}
