'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
    </nav>
  );
}
