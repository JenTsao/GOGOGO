/**
 * 周杰伦彩蛋库：文案全部为「歌名梗」原创句——歌名与日期是事实性引用，
 * 句子本身自创并化用歌曲意境；歌词原文不直接引用（版权文本）。
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

// 倒计时里程碑句：命中天数由驾驶舱问候语接管
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

// 特定日期彩蛋（MM-DD）：生日 / 专辑与单曲发行日 / 高考日，命中才显示
const JAY_DATES: Record<string, string> = {
  '01-18': '🎂 今天是周杰伦生日，戴上耳机开工吧',
  '07-16': '🌾 《以父之名》周杰伦日（2003）——音乐的皇帝',
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

/** 氛围句池总量（隐藏歌单展示用） */
export const jayLineCount = JAY_LINES.length;

// 今日三件事空状态句：随机取一句，兼具引导性
const TASK_EMPTY_LINES: string[] = [
  '《搁浅》的事，先捞一件——写下今天第一件事',
  '《简单爱》学习：今天从一件小事开始',
  '《最伟大的作品》从第一件开始——写下今天的要事',
];

/** 任务空状态随机句（组件挂载时取一次，避免每帧重抽闪烁） */
export function randomJayTaskLine(): string {
  return TASK_EMPTY_LINES[Math.floor(Math.random() * TASK_EMPTY_LINES.length)];
}

// 三件事全部完成句：达成时刻的确定性奖励
const TASK_DONE_LINES: string[] = [
  '《最伟大的作品》今天的版本，你已经写完了',
  '《轨迹》又向前一格——今天的三件事，全部说好不哭地完成了',
  '《以父之名》级的执行力：安静地，把今天做完了',
];

/** 三件事全勤随机句（挂载时取一次） */
export function randomJayTaskDoneLine(): string {
  return TASK_DONE_LINES[Math.floor(Math.random() * TASK_DONE_LINES.length)];
}

// 错题入库句：收录成功那一刻的安慰与鼓励
const MISTAKE_LINES: string[] = [
  '《对不起》说给昨天的粗心——重做一遍，就是最好的回答',
  '错题本又厚一页——《轨迹》不会骗人，你离考点更近了',
  '《回到过去》不如写好现在：这道题会感谢今天收录它的你',
];

/** 错题入库随机句 */
export function randomJayMistakeLine(): string {
  return MISTAKE_LINES[Math.floor(Math.random() * MISTAKE_LINES.length)];
}

// 天气彩蛋：按 OpenWeather 中文描述关键词优先匹配，再按气温极值兜底
const WEATHER_RULES: { match: RegExp; line: string }[] = [
  { match: /雷/, line: '《龙卷风》升级成了雷阵雨——留在室内，把笔稳住' },
  { match: /雨/, line: '《听见下雨的声音》——窗外下雨，正好室内专注' },
  { match: /雪/, line: '《发如雪》般的天气——围巾戴好，别让手冻僵' },
  { match: /雾|霾/, line: '雾天限定：《轨迹》不会迷路，跟着错题本走' },
  { match: /阴|多云/, line: '《晴天》暂时离线，《星晴》在线陪读' },
  { match: /晴/, line: '《晴天》本日正在播放——窗外的太阳替你充能' },
];
const WEATHER_TEMP_RULES: { min?: number; max?: number; line: string }[] = [
  { min: 32, line: '高温预警：《七里香》季节太热情，多喝水再开工' },
  { max: 0, line: '冰点以下——《枫》都冻红了，手套戴上，笔别停' },
];

/** 天气彩蛋：先按天气描述匹配，再按气温极值匹配；都不命中返回 null */
export function jayWeatherEgg(temp: number, desc: string): string | null {
  for (const r of WEATHER_RULES) {
    if (r.match.test(desc)) return r.line;
  }
  const t = WEATHER_TEMP_RULES.find(
    (r) => (r.min === undefined || temp >= r.min) && (r.max === undefined || temp <= r.max)
  );
  return t?.line ?? null;
}

// 情绪打卡句：按 emoji 分档——负面情绪给安慰，正面情绪给燃料
const MOOD_LINES: Record<string, string> = {
  '😊': '《阳光宅男》配这张表情——电量满格，继续保持',
  '😃': '《星晴》也不过如此——今天的光是你自己发的',
  '😐': '《安静》地过完一天也算赢，明天《晴天》见',
  '😟': '焦虑是《龙卷风》前的风平——深呼吸，把它写进语音备忘里',
  '😫': '累了就听《稻香》——简单一点，早点睡',
};

/** 按当日打卡 emoji 取句（未知 emoji 回退通用句） */
export function jayMoodLine(emoji: string): string {
  return MOOD_LINES[emoji] ?? '《晴天》或《夜曲》，都是你——今天也记下一笔';
}

// 周常彩蛋：周一早晨「开课」问候（优先级低于日期/里程碑彩蛋）
const WEEKLY_MONDAY = '周一早——《三年二班》开课了，这周也稳住节奏';

/** 周一早晨（5-11 点）返回开课句，其余时间 null */
export function jayWeeklyEgg(d: Date): string | null {
  return d.getDay() === 1 && d.getHours() >= 5 && d.getHours() < 11 ? WEEKLY_MONDAY : null;
}

/** 倒计时里程碑彩蛋：命中返回句子，未命中 null */
export function jayMilestoneEgg(daysLeft: number): string | null {
  return MILESTONE_LINES[daysLeft] ?? null;
}

/** 当天是否命中日期彩蛋；未命中返回 null（问候语回退里程碑/常规逻辑） */
export function jayEggForToday(d: Date = new Date()): string | null {
  const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return JAY_DATES[key] ?? null;
}
