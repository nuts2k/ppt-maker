# Open Design 参考记录

> 本文档仅用于记录和分析 `open-design`，不代表本项目将基于它进行开发。`open-design` 是外部参考代码，保持只读。

## 来源与当前版本

- 仓库：<https://github.com/nexu-io/open-design>
- 本地目录：[open-design](/Users/kelin/Work/ppt-maker/open-design)
- 获取方式：浅克隆（`--depth 1`）
- 克隆时分支：`main`
- 克隆时提交：`3447f60a3484c59c3bece4a437f53dd6e8df08a8`
- Git 元数据：已删除 `.git`，当前目录不是 Git 仓库

## 产品定位

Open Design 是一个本地优先的设计生成平台，面向 Claude Code、Codex、Cursor、OpenCode 等编码 Agent，提供设计技能、设计系统、插件、原型/仪表盘/演示文稿/图片等产物生成能力。

这里只借鉴其产品形态、技术选型和代码组织方式，不将其视为本项目的基础工程、依赖或未来产品方向。

## 主要技术栈

| 层次 | 技术 |
|---|---|
| Web 主应用 | Next.js 16 App Router、React 18、TypeScript |
| UI 与交互 | Tailwind CSS 4、Lucide React、Motion、Lexical |
| 本地服务 | Node.js 24、Express 5、SSE |
| 数据存储 | SQLite + `better-sqlite3` |
| 桌面端 | Electron 41，Renderer 沙箱与 Sidecar IPC |
| 落地页 | Astro 6，React 主要用于构建时渲染 |
| Agent / AI 集成 | OpenAI SDK、Anthropic SDK、Model Context Protocol SDK、多种 CLI 适配器 |
| 产物处理 | Excalidraw、Shiki、jsPDF、pdf-lib、PptxGenJS、node-pty |
| 测试 | Vitest、Testing Library、Playwright |
| 工具链 | pnpm workspace、tsx、esbuild、PostCSS、TypeScript |
| 部署 | Docker Compose、AWS SAM，并提供 Azure 配置 |

## 架构概览

```text
Next.js Web / Electron 桌面壳
             │
             ▼
Node.js + Express 本地 Daemon
             │
             ├── SQLite 本地项目与会话数据
             ├── HTTP API / SSE 流式接口
             ├── MCP stdio server
             └── 启动并管理外部 CLI Agent
```

核心链路是：用户输入设计需求 → Daemon 选择技能/设计模板/设计系统 → 启动本机 Agent CLI → 生成文件 → 在沙箱 iframe 中预览 → 导出 HTML、PDF、PPTX、ZIP 或 MP4。

## PPT / Deck 制作机制

Open Design 的 PPT 方案是“HTML Deck 优先”，不是让 Agent 直接拼装 PowerPoint 文件：

```text
用户需求
  → Agent 选择 deck skill + DESIGN.md
  → 生成单文件 HTML Deck
  → iframe 预览
  → Electron Chromium 按真实布局渲染
  → 导出 PPTX / PDF / 图片
```

### HTML Deck 约定

- 每页通常使用 `<section class="slide">`，部分模板使用 `data-screen-label` 等标记。
- 默认舞台为 1920×1080，并由固定框架处理缩放适配、键盘翻页、页码和打印样式。
- Agent 主要填充主题变量、局部样式和每页内容，不重复实现导航和打印框架。
- `design-templates/html-ppt-*` 提供具体的 Deck 视觉模板；相关技能包括 `slides`、`pptx`、`pptx-generator` 和 `frontend-slides`。

### 两种 PPTX 导出模式

1. **截图型 PPTX（默认，视觉保真优先）**

   Electron 创建隐藏 Chromium 窗口，加载 HTML，隐藏导航/备注等辅助元素，冻结动画后逐页截图。Daemon 再用 `PptxGenJS` 创建 PPTX，每页铺一张全尺寸 PNG/JPEG。

   - 所见即所得，复杂 CSS、中文字体和 SVG 还原更稳定。
   - PPT 中的文字不可编辑，本质是每页一张图片。
   - 根据 Deck 实际宽高计算比例，不强制 16:9。

2. **可编辑型 PPTX（`editable: true`）**

   Electron 仍先完成 HTML 的真实布局，然后注入 vendored `dom-to-pptx`，把 DOM 映射为 PowerPoint 原生文本框、形状和 SVG。

   - 文本和图形可以在 PowerPoint 中继续编辑。
   - CSS 复杂效果、字体 fallback 和细节布局可能出现偏差，不保证像素级一致。
   - 导出前会处理显式背景、CJK 字体提升、超大单行文字和 SVG 兼容。

关键实现位置：

- Deck 固定框架：[packages/contracts/src/prompts/deck-framework.ts](/Users/kelin/Work/ppt-maker/open-design/packages/contracts/src/prompts/deck-framework.ts)
- Electron 渲染与截图/可编辑导出：[apps/desktop/src/main/deck-capture.ts](/Users/kelin/Work/ppt-maker/open-design/apps/desktop/src/main/deck-capture.ts)
- 截图组装 PPTX：[apps/daemon/src/deck-export.ts](/Users/kelin/Work/ppt-maker/open-design/apps/daemon/src/deck-export.ts)
- 导出 API：[apps/daemon/src/import-export-routes.ts](/Users/kelin/Work/ppt-maker/open-design/apps/daemon/src/import-export-routes.ts)
- Web 导出调用：[apps/web/src/runtime/exports.ts](/Users/kelin/Work/ppt-maker/open-design/apps/web/src/runtime/exports.ts)
- Sidecar 导出协议：[packages/sidecar-proto/src/index.ts](/Users/kelin/Work/ppt-maker/open-design/packages/sidecar-proto/src/index.ts)

### 设计取舍

- 视觉一致性优先：使用截图型 PPTX。
- 后续编辑优先：使用 `dom-to-pptx` 可编辑型 PPTX。
- 内容生成和视觉设计主要发生在 HTML、Skill 和 `DESIGN.md` 层，而不是直接操作 PowerPoint XML。

## 目录参考

- `apps/web`：Next.js Web 应用
- `apps/daemon`：本地 Node/Express Daemon、API、Agent 运行时和 MCP 服务
- `apps/desktop`：Electron 主进程与桌面运行时
- `apps/packaged`：打包后的桌面启动与 sidecar 管理
- `apps/landing-page`：Astro 落地页
- `packages/components`：共享 React UI 组件
- `packages/contracts`：跨模块数据契约
- `packages/host`、`packages/sidecar*`：渲染宿主和 Sidecar 通信协议
- `packages/plugin-runtime`：插件解析、校验和运行时
- `design-systems`：以 `DESIGN.md`、tokens 和预览文件组织的设计系统
- `skills`：可组合的设计技能
- `plugins`：官方及社区插件
- `deploy`：Docker、AWS、Azure 部署相关文件

## 关键配置文件

- 根依赖与脚本：[open-design/package.json](/Users/kelin/Work/ppt-maker/open-design/package.json)
- Workspace：[open-design/pnpm-workspace.yaml](/Users/kelin/Work/ppt-maker/open-design/pnpm-workspace.yaml)
- Web 依赖：[open-design/apps/web/package.json](/Users/kelin/Work/ppt-maker/open-design/apps/web/package.json)
- Daemon 依赖：[open-design/apps/daemon/package.json](/Users/kelin/Work/ppt-maker/open-design/apps/daemon/package.json)
- 架构原文：[open-design/README.md](/Users/kelin/Work/ppt-maker/open-design/README.md)

## 只读使用约束

1. `open-design` 仅供查阅、搜索和技术调研。
2. 不在 `open-design` 内修改、删除、重命名或新增文件。
3. 不在 `open-design` 内安装依赖、生成构建产物或运行会写入文件的命令。
4. 本项目未来的实现、依赖和产品规划不得默认继承 Open Design；如需借鉴，必须重新评估并在本项目自身目录实现。
