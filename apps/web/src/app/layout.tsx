import type { Metadata } from 'next';
import { Sidebar } from '@/components/Sidebar';
import { EasterEggs } from '@/components/EasterEggs';
import { DailyKnowledge } from '@/components/DailyKnowledge';
import { THEME_BOOTSTRAP } from '@/lib/webTheme';
import { SIDEBAR_BOOTSTRAP } from '@/lib/webSidebar';
import './globals.css';

export const metadata: Metadata = {
  title: '高考副驾驶 · 知识操作系统',
  description: '专业化知识治理后台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning：data-theme / data-sidebar 由预绘制脚本在客户端设置，与 SSR 输出必然不同
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* 同步内联脚本：先于任何内容渲染设置主题，避免深色用户首屏闪白 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {/* 同步回填侧边栏折叠态：避免折叠用户首屏闪一帧展开宽度 */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOTSTRAP }} />
        <div className="shell">
          <Sidebar />
          <main className="main">
            <DailyKnowledge />
            {children}
          </main>
        </div>
        <EasterEggs />
      </body>
    </html>
  );
}
