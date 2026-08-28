// 菜单2：语义检索中心（探针式搜索）
// 混合检索：关键词 + pgvector 向量语义检索；层级标签管理
export default function SearchPage() {
  return (
    <div>
      <h1 className="page-title">语义检索中心</h1>
      <div className="panel">
        <strong>混合检索框</strong>
        <p className="placeholder">
          支持关键词 + 向量语义检索。例如输入“那种需要设辅助函数的导数题”，系统从笔记中语义匹配最相关 3 篇（pgvector，vector(1536)）。Phase 2 配置向量检索。
        </p>
      </div>
      <div className="split">
        <div className="panel">
          <strong>层级标签树</strong>
          <p className="placeholder">
            左侧标签树（如 #数学/微积分/导数），支持拖拽重命名、合并、批量关联笔记。
          </p>
        </div>
        <div className="panel">
          <strong>检索结果</strong>
          <p className="placeholder">命中的笔记卡片列表，点击跳转知识工坊编辑。</p>
        </div>
      </div>
    </div>
  );
}
