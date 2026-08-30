'use client';

import { useEffect, useState } from 'react';

export type WebTheme = 'light' | 'dark';

const STORAGE_KEY = 'gk-web-theme';

/**
 * 预绘制脚本：必须在首屏渲染前同步执行，否则深色用户会先闪一帧白底。
 * localStorage 显式选择优先，未选择时跟随系统 prefers-color-scheme。
 * 用法：layout <body> 顶部 <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})()`;

// 当前生效主题：以 html[data-theme] 为唯一事实来源（CSS 变量层据此切换）
export function currentWebTheme(): WebTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** 手动切换并持久化（无存储能力时仅本次会话生效） */
export function setWebTheme(theme: WebTheme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 隐私模式等 localStorage 不可用：静默降级为会话级
  }
}

/**
 * 响应式读取当前主题：MutationObserver 监听 html[data-theme]。
 * 供需要具体色值（而非 CSS 变量）的场景使用：Monaco / Mermaid / recharts。
 */
export function useWebTheme(): WebTheme {
  const [theme, setTheme] = useState<WebTheme>('light');
  useEffect(() => {
    setTheme(currentWebTheme());
    const ob = new MutationObserver(() => setTheme(currentWebTheme()));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => ob.disconnect();
  }, []);
  return theme;
}
