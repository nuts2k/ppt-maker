# M0 项目骨架与技术基线执行计划

## 1. 准备与工具链

- [x] 加载 `trellis-before-dev` 和 backend spec 索引。
- [x] 固定 Node.js 24 LTS、pnpm 10 和 TypeScript ESM/strict 基线。
- [x] 创建只包含真实代码包的 pnpm workspace，确保 `open-design/` 不在 workspace、lint、format 或 test 范围内。
- [x] 配置 TypeScript、Biome、Vitest、统一脚本和根开发说明。
- [x] 安装依赖后提交 lockfile，并验证全新安装命令。

## 2. Core 契约

- [x] 实现 16:9 比例校验、容差常量和像素 → PPTX 坐标换算。
- [x] 定义并运行时校验 `TextBlock`、页面 manifest、阶段记录和环境诊断 schema。
- [x] 定义平台无关 `OcrProvider` 请求/响应和错误契约。
- [x] 为坐标、比例、schema 兼容和错误输入增加单元测试。

## 3. 环境诊断 CLI

- [x] 实现 `doctor` 人类可读输出。
- [x] 实现 `doctor --json` 结构化输出。
- [x] 检查 Node/pnpm、macOS/架构、Swift、PowerPoint 和微软雅黑。
- [x] 覆盖当前 Node 25 偏离、字体缺失和工具缺失等可测试分支。

## 4. Apple Vision OCR 探针

- [x] 创建最小 Swift Vision 可执行程序和构建脚本。
- [x] 设计版本化 JSON 请求/响应，并在 TypeScript 侧校验。
- [x] 准备可提交的简体中文、英文和混排 fixtures。
- [x] 输出识别内容、像素 bbox、置信度和可获得的方向信息。
- [x] 记录 Apple Vision 的支持边界；若不可行，更新研究文档和替代建议。

## 5. 图片与 PPTX 探针

- [x] 实现 PNG/JPEG 元数据读取和 16:9 校验入口。
- [x] 使用 PptxGenJS 生成背景图 + 微软雅黑文本框的 16:9 PPTX。
- [x] 在 PowerPoint for Mac 中人工验证可打开、比例和文本可编辑性，并把结果写入研究记录。
- [x] 微软雅黑缺失时验证诊断和阻止导出行为；不自动安装字体。

## 6. 质量、规范与收尾

- [x] 运行格式检查、类型检查、单元测试和探针集成检查。
- [x] 检查所有命令均未修改 `open-design/`。
- [x] 使用真实实现更新 `.trellis/spec/backend/` 相关规范，不填写无真实代码依据的 frontend 模板。
- [x] 运行 `trellis-check` 并修复问题。
- [x] 更新 `ROADMAP.md` 的 M0 状态和父任务执行清单。
- [x] 用户确认结果后提交并归档 M0；父路线图任务继续保留。

## 7. 计划验证命令

最终命令名以实际 `package.json` 为准，至少应提供等价入口：

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm ppt-maker doctor
pnpm ppt-maker doctor --json
pnpm probe:ocr <fixture>
pnpm probe:pptx <fixture> --output <output.pptx>
python3 ./.trellis/scripts/task.py validate 07-20-project-foundation
git diff --check
```

## 8. 风险与回滚点

- Node 原生依赖不支持 Node 24 arm64：停止依赖扩张，优先更换依赖或改用纯 JS/系统能力。
- Apple Vision 输出不满足文本/坐标需求：保留契约，替换 Provider，不扩散 Vision 类型。
- Swift 构建流程过重：评估直接系统桥接或独立预构建二进制，但不得把网络 OCR 变成默认路径。
- PptxGenJS 与 PowerPoint 字体表现不符合预期：保存样例和截图，在 M1 前调整字体/坐标策略。
