// 菜单1：知识工坊（治理核心）
// 双侧栏：左侧 GitHub 文件树，右侧 Monaco Editor；AI 精炼工具栏 + 版本控制
export default function WorkshopPage() {
  return (
    <div>
      <h1 className="page-title">知识工坊</h1>
      <div className="split">
        <div className="panel">
          <strong>GitHub 文件树（Obsidian 目录）</strong>
          <p className="placeholder">
            完整 Obsidian 目录树，点击展开/折叠。Phase 1 仅文件树预览 + 只读编辑器；Phase 2 支持下载与编辑。
          </p>
        </div>
        <div className="panel">
          <strong>Monaco Editor</strong>
          <p className="placeholder">
            VS Code 同款，支持 Markdown 编写、拖拽传图自动压缩 WebP。Phase 3 完整编辑能力。
          </p>
        </div>
      </div>
      <div className="panel">
        <strong>AI 精炼工具栏</strong>
        <p className="placeholder">
          勾选多篇笔记 → “🤖 合并精炼”生成终极复习卡片；“🧠 生成知识图谱”输出 Mermaid 关系图。版本控制：自动快照，一键回滚至 7 天前。
        </p>
      </div>
    </div>
  );
}
