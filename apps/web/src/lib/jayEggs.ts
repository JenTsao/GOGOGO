/**
 * 周杰伦彩蛋库（web 端）：与移动端 src/lib/jayEggs.ts 同源——句池与日期表保持一致，
 * 改文案请两端同步。差异点：本文件为纯 TS（可被服务端组件引用），且日期判定统一
 * 北京时间口径（+8h 后读 UTC 日历），任意时区服务器/开发机结果一致。
 * 歌名与日期为事实性引用，句子为化用意境的自创文案；歌词原文不直接引用（版权红线）。
 */

// 通用氛围句池：控制台横幅 / Konami 成就随机取用（与移动端一致）
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
  '《搁浅》的事先放一放，眼前的这一节先划完',
  '《听妈妈的话》：早点睡，明天的专注更值钱',
  '《半岛铁盒》里锁的不是秘密，是刷过的每一套卷',
  '《龙卷风》是冲刺的节奏，《安静》是考场的心态',
  '《三年二班》的态度：一件事，做到好',
  '《不能说的秘密》：你的进步，卷子会替你说',
  '《七里香》开在窗前，笔尖也别停下',
  '《星晴》是说：今晚抬头看一眼，然后继续',
  '《退后》是给别人看的，《向前》是给自己的',
  '《轨迹》不会骗人：每一次专注都在记分',
  '《回到过去》不如写好现在，错题就是时光机',
  '《止战之殇》之外，你的战场只有这张书桌',
  '《威廉古堡》里也没有捷径，练才是魔法',
  '《对不起》说给昨天的粗心，今天重做一遍',
  '《分裂》不必，一道题一道题地赢回来',
  '《最后的战役》还没打，先把今天的堡垒垒好',
  '《说好不哭》，考完再哭，现在笑着冲',
  '哎哟，不错哦——这节心流，保持住',
];

// 倒计时里程碑句：总览页按距高考天数命中
const MILESTONE_LINES: Record<number, string> = {
  100: '倒计时 100 天——像《蜗牛》一样，一寸一寸往上',
  50: '倒计时 50 天——切换《以父之名》模式：安静，但强大',
  30: '倒计时 30 天——《龙卷风》节奏可以来了，但手要稳',
  10: '倒计时 10 天——《稻香》的时刻：简单，熟悉，不慌',
  7: '倒计时 7 天——最后一周，把《搁浅》的知识点捞起来',
  3: '倒计时 3 天——把《搁浅》的错题最后捞一遍',
  2: '倒计时 2 天——文具、准考证、《轨迹》里的每个考点，都过一遍',
  1: '倒计时 1 天——《三年二班》的名字，明天会被点响',
  0: '高考首日——去写你的《最伟大的作品》',
};

// 特定日期彩蛋（北京日期 MM-DD）：生日 / 专辑与单曲发行日 / 高考日
const JAY_DATES: Record<string, string> = {
  '01-18': '🎂 今天是周杰伦生日，戴上耳机开工吧',
  '07-16': '🌾 《七里香》单曲首播纪念日（2004）——这个夏天，属于你',
  '07-19': '🎹 《八度空间》发行日（2002）——音阶往上，你也一样',
  '07-31': '🎷 《叶惠美》发行日（2003）——谢谢妈妈，也谢谢努力的自己',
  '08-03': '🌾 《七里香》专辑发行日（2004）——这个夏天，属于你',
  '09-14': '🎹 《范特西》发行日（2001）——把想象力的档位拉满',
  '11-01': '🎼 《十一月的萧邦》发行日（2005）——十一月，适合安静地刷题',
  '06-07': '高考首日——去写你的《最伟大的作品》',
  '06-08': '第二天了——《最后的战役》，稳住节奏',
};

let lastIdx = -1;

/** 取下一句：避免与上一句重复，制造「换一句」的手感 */
export function nextJayLine(): string {
  let i = Math.floor(Math.random() * JAY_LINES.length);
  if (JAY_LINES.length > 1 && i === lastIdx) i = (i + 1) % JAY_LINES.length;
  lastIdx = i;
  return JAY_LINES[i];
}

/** 氛围句池总量 */
export const jayLineCount = JAY_LINES.length;

/** 完整句池（按声明顺序）：Konami 三连击的终极成就用它输出歌单目录 */
export function allJayLines(): string[] {
  return [...JAY_LINES];
}

/** 周常彩蛋：周一早晨「开课」问候（北京口径），其余时间 null */
export function jayWeeklyEgg(d: Date = new Date()): string | null {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return bj.getUTCDay() === 1 && bj.getUTCHours() >= 5 && bj.getUTCHours() < 11
    ? '周一早——《三年二班》开课了，这周也稳住节奏'
    : null;
}

/** 倒计时里程碑彩蛋：命中返回句子，未命中 null */
export function jayMilestoneEgg(daysLeft: number): string | null {
  return MILESTONE_LINES[daysLeft] ?? null;
}

/** 当天日期彩蛋：统一北京日期口径（+8h 后读 UTC 日历），未命中返回 null */
export function jayEggForToday(d: Date = new Date()): string | null {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const key = `${String(bj.getUTCMonth() + 1).padStart(2, '0')}-${String(bj.getUTCDate()).padStart(2, '0')}`;
  return JAY_DATES[key] ?? null;
}

/** 距高考天数（6 月 7 日 09:00 北京时间，与移动端口径一致） */
export function daysToGaokaoBJ(now: Date = new Date()): number {
  const y = new Date(now.getTime() + 8 * 3600 * 1000).getUTCFullYear();
  // 09:00 北京时间 = 01:00 UTC
  const exam = now.getTime() >= Date.UTC(y, 5, 7, 1, 0, 0)
    ? Date.UTC(y + 1, 5, 7, 1, 0, 0)
    : Date.UTC(y, 5, 7, 1, 0, 0);
  return Math.ceil((exam - now.getTime()) / 86400000);
}
