import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { THEME_BOOTSTRAP } from '@/lib/webTheme';
import './globals.css';

export const metadata: Metadata = {
  title: '高考副驾驶 · 知识操作系统',
  description: '专业化知识治理后台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning：data-theme 由预绘制脚本在客户端设置，与 SSR 输出必然不同
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* 同步内联脚本：先于任何内容渲染设置主题，避免深色用户首屏闪白 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <div className="shell">
          <aside className="sidebar">
            <div className="logo">高考副驾驶</div>
            <Nav />
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
