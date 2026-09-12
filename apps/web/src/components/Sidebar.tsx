'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { currentWebTheme, setWebTheme, type WebTheme } from '@/lib/webTheme';
import { currentSidebarCollapsed, setSidebarCollapsed } from '@/lib/webSidebar';

const MENUS = [
  { href: '/', label: '总览', icon: '🏠' },
  { href: '/workshop', label: '知识工坊', icon: '✍️' },
  { href: '/library', label: '知识库', icon: '📚' },
  { href: '/search', label: '语义检索', icon: '🔍' },
  { href: '/tools', label: 'AI 工具区', icon: '🧰' },
  { href: '/agents', label: '命题 Agent', icon: '🎭' },
  { href: '/compile', label: '编译输出', icon: '📦' },
  { href: '/mistakes', label: '错题本', icon: '📕' },
  { href: '/insights', label: '画像大屏', icon: '📈' },
  { href: '/review', label: '每日复盘', icon: '🌙' },
  { href: '/questions', label: '每日猜题', icon: '🎯' },
];

// 折叠箭头：展开时朝左（收起方向），折叠态由 CSS 旋转 180°，避免图标依赖水合状态而闪烁
function ChevronIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M11 6L5 12l6 6M19 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 侧边栏：logo + 折叠开关 + 导航 + 主题切换。
 * usePathname 高亮当前页（layout 是服务端组件，交互部分收敛到此客户端叶子）。
 * 折叠宽度由 html[data-sidebar] 驱动（见 globals.css），本组件只负责读写该属性。
 */
export function Sidebar() {
  const pathname = usePathname();
  // 初始 'light'/展开与 SSR 输出一致，挂载后再读真实状态，避免水合不匹配
  const [theme, setTheme] = useState<WebTheme>('light');
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setTheme(currentWebTheme());
    setCollapsed(currentSidebarCollapsed());
  }, []);

  const toggleTheme = () => {
    const next: WebTheme = theme === 'dark' ? 'light' : 'dark';
    setWebTheme(next);
    setTheme(next);
  };
  const toggleCollapsed = () => {
    const next = !collapsed;
    setSidebarCollapsed(next);
    setCollapsed(next);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="logo">高考副驾驶</div>
        <button
          type="button"
          className="collapse-toggle"
          onClick={toggleCollapsed}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          aria-expanded={!collapsed}
          aria-controls="sidebar-nav"
        >
          <ChevronIcon />
        </button>
      </div>
      <nav id="sidebar-nav">
        {MENUS.map((m) => {
          // 精确匹配根路由；其余前缀匹配（如 /mistakes 与其子路径）
          const active = m.href === '/' ? pathname === '/' : pathname.startsWith(m.href);
          return (
            <Link
              key={m.href}
              href={m.href}
              title={m.label}
              className={`nav-item${active ? ' nav-active' : ''}`}
            >
              <span className="nav-icon">{m.icon}</span>
              <span className="sidebar-collapsed-hide">{m.label}</span>
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        className="theme-toggle"
        onClick={toggleTheme}
        title={theme === 'dark' ? '浅色模式' : '深色模式'}
      >
        <span className="nav-icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
        <span className="sidebar-collapsed-hide">{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
      </button>
    </aside>
  );
}
