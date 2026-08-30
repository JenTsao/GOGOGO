'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { currentWebTheme, setWebTheme, type WebTheme } from '@/lib/webTheme';

const MENUS = [
  { href: '/', label: '总览' },
  { href: '/workshop', label: '知识工坊' },
  { href: '/search', label: '语义检索' },
  { href: '/compile', label: '编译输出' },
  { href: '/mistakes', label: '错题本' },
  { href: '/insights', label: '画像大屏' },
  { href: '/review', label: '每日复盘' },
];

// 侧边导航：usePathname 高亮当前页（layout 是服务端组件做不了，抽成客户端叶子）
export function Nav() {
  const pathname = usePathname();
  // 初始 'light' 与 SSR 输出一致，挂载后再读真实主题，避免水合文本不匹配
  const [theme, setTheme] = useState<WebTheme>('light');
  useEffect(() => setTheme(currentWebTheme()), []);
  const toggleTheme = () => {
    const next: WebTheme = theme === 'dark' ? 'light' : 'dark';
    setWebTheme(next);
    setTheme(next);
  };
  return (
    <nav>
      {MENUS.map((m) => {
        // 精确匹配根路由；其余前缀匹配（如 /mistakes 与其子路径）
        const active = m.href === '/' ? pathname === '/' : pathname.startsWith(m.href);
        return (
          <Link key={m.href} href={m.href} className={`nav-item${active ? ' nav-active' : ''}`}>
            {m.label}
          </Link>
        );
      })}
      <button type="button" className="theme-toggle" onClick={toggleTheme}>
        {theme === 'dark' ? '☀️ 浅色模式' : '🌙 深色模式'}
      </button>
    </nav>
  );
}
