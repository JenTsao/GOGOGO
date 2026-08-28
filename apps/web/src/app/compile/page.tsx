// 菜单3：编译与输出（武器库）
// 左侧资源池勾选，右侧编译设置生成 PDF / Anki / 大纲；历史记录
export default function CompilePage() {
  return (
    <div>
      <h1 className="page-title">编译与输出</h1>
      <div className="split">
        <div className="panel">
          <strong>资源池</strong>
          <p className="placeholder">勾选任意笔记、错题、代码片段作为编译素材。</p>
        </div>
        <div className="panel">
          <strong>编译设置</strong>
          <p className="placeholder">
            一键生成 📄 复习 PDF（A4 排版）、📱 Anki 卡片包 (.apkg) 或 📋 纯文本大纲。Phase 3 后台编译任务实现。
          </p>
        </div>
      </div>
      <div className="panel">
        <strong>历史记录</strong>
        <p className="placeholder">底部显示最近 10 次编译产物（knowledge_compilations 表），支持重新下载。</p>
      </div>
    </div>
  );
}
