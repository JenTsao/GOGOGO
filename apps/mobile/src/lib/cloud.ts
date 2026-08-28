// 云端读取：免登录经 security definer RPC 校验 access_key（RLS 不放行匿名直查）
import { localDateStr } from '@/store/reminderStore';

export interface DailyLearning {
  date: string;
  knowledge_body: string | null;
  question_text: string | null;
  answer: string | null;
}

export interface CloudConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessKey: string;
}

// 拉取指定日期（默认今天，北京时间）的每日备课内容；未生成返回 null
export async function fetchDaily(cfg: CloudConfig, date?: string): Promise<DailyLearning | null> {
  const base = cfg.supabaseUrl.replace(/\/+$/, '');
  if (!base || !cfg.supabaseAnonKey || !cfg.accessKey) {
    throw new Error('请在「我的」配置云端地址 / Anon Key / 访问密钥');
  }
  // 10s 超时兜底：Supabase 挂起时让调用方进入 error 降级而非永久 loading
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${base}/rest/v1/rpc/get_daily_by_key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${cfg.supabaseAnonKey}`,
      },
      body: JSON.stringify({ access_key: cfg.accessKey, target_date: date ?? localDateStr(new Date()) }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as DailyLearning[];
    return rows?.[0] ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// 周复盘产物（weekly_reviews.content）
export interface WeeklyReview {
  week_start: string;
  content: {
    summary: string;
    risks: string[];
    focusAdvice: string[];
    syllabusAlert: string | null;
    news: { title: string; url: string }[];
  };
}

// 拉取最近一次周复盘（≤7 天内有效，更旧返回 null 让调用方提示）
export async function fetchWeekly(cfg: CloudConfig): Promise<WeeklyReview | null> {
  const base = cfg.supabaseUrl.replace(/\/+$/, '');
  if (!base || !cfg.supabaseAnonKey || !cfg.accessKey) {
    throw new Error('请在「我的」配置云端地址 / Anon Key / 访问密钥');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${base}/rest/v1/rpc/get_weekly_by_key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${cfg.supabaseAnonKey}`,
      },
      body: JSON.stringify({ p_access_key: cfg.accessKey }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as WeeklyReview[];
    return rows?.[0] ?? null;
  } finally {
    clearTimeout(timer);
  }
}
