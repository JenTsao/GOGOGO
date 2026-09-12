const STORAGE_KEY = 'gk-web-sidebar';
export type SidebarState = 'expanded' | 'collapsed';

/**
 * 预绘制脚本：与主题同理，必须在首屏渲染前同步执行，否则折叠用户会先闪一帧展开宽度。
 * 以 html[data-sidebar] 为唯一事实来源，CSS 层据此切换宽度，React 无需参与首帧布局。
 */
export const SIDEBAR_BOOTSTRAP = `(function(){try{var c=localStorage.getItem('${STORAGE_KEY}');document.documentElement.dataset.sidebar=c==='collapsed'?'collapsed':'expanded';}catch(e){}})()`;

// 当前折叠态：读 html[data-sidebar]，与 SSR 输出（脚本回填）保持一致
export function currentSidebarCollapsed(): boolean {
  return document.documentElement.dataset.sidebar === 'collapsed';
}

/** 切换折叠态并持久化（无存储能力时仅本次会话生效） */
export function setSidebarCollapsed(collapsed: boolean) {
  document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // 隐私模式等 localStorage 不可用：静默降级为会话级
  }
}
