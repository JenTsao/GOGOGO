// 路由级加载骨架：force-dynamic 页面等 Supabase 返回时不再整页白屏（TTFB 期间先出结构）
// 根级一份对所有 dynamic 页生效；骨架复用 globals.css 令牌，深浅色自动适配
// 注意：layout 已提供 <main className="main">，此处直接输出内容避免嵌套
export default function Loading() {
  return (
    <>
      <h1 className="page-title">加载中…</h1>
      <div className="stat-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel stat-card skeleton">
            <div className="skeleton-line" style={{ width: '40%' }} />
            <div className="skeleton-line" style={{ width: '72%' }} />
            <div className="skeleton-line" style={{ width: '56%' }} />
          </div>
        ))}
      </div>
      <div className="panel skeleton" style={{ minHeight: 180 }}>
        <div className="skeleton-line" style={{ width: '28%' }} />
        <div className="skeleton-line" style={{ width: '88%' }} />
        <div className="skeleton-line" style={{ width: '64%' }} />
        <div className="skeleton-line" style={{ width: '76%' }} />
      </div>
      <div className="panel skeleton" style={{ minHeight: 140 }}>
        <div className="skeleton-line" style={{ width: '24%' }} />
        <div className="skeleton-line" style={{ width: '80%' }} />
        <div className="skeleton-line" style={{ width: '50%' }} />
      </div>
    </>
  );
}
