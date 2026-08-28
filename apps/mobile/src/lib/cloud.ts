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
  const res = await fetch(`${base}/rest/v1/rpc/get_daily_by_key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${cfg.supabaseAnonKey}`,
    },
    body: JSON.stringify({ access_key: cfg.accessKey, target_date: date ?? localDateStr(new Date()) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as DailyLearning[];
  return rows?.[0] ?? null;
}
