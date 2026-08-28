import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '高考副驾驶 · 知识操作系统',
  description: '专业化知识治理后台',
};

const menus = [
  { href: '/workshop', label: '知识工坊' },
  { href: '/search', label: '语义检索中心' },
  { href: '/compile', label: '编译与输出' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="logo">高考副驾驶</div>
            <nav>
              {menus.map((m) => (
                <Link key={m.href} href={m.href} className="nav-item">
                  {m.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
