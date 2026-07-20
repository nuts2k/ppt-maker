# M0 项目骨架与技术基线

## Goal

建立 PPT Maker 的最小、可重复工程基础，并用可运行的小型探针验证 M1 所依赖的关键技术边界：macOS 离线 OCR、16:9 坐标换算、图片读取、微软雅黑预检以及 PptxGenJS 在 Microsoft PowerPoint for Mac 中的基本输出。M0 只冻结经过实验验证的基础契约，不实现完整的图片转可编辑 PPTX 流水线。

## Background

- 仓库当前只有规划和参考文档，没有 `package.json`、TypeScript 配置或产品代码。
- 路线图已经确认首期平台为 macOS，产品入口为 16:9 页面图片，OCR 离线优先，PPTX 中目标文字统一使用微软雅黑。
- 当前开发环境为 Apple Silicon macOS 26.4；Node.js 25.6.1、pnpm 10.32.0、Python 3.14.4 和 Swift 6.2.3 可用。
- Microsoft PowerPoint 已安装；当前检查未发现 Tesseract，也未通过 Spotlight 找到微软雅黑字体文件。
- `open-design/` 是严格只读参考，不得作为代码基础或被任何构建、安装、格式化命令修改。

## Requirements

### R1. 可重复工具链

- 项目必须明确固定受支持的 Node.js LTS 主版本、pnpm 主版本和 TypeScript 配置。
- 必须提供统一的开发、构建、类型检查、格式检查、测试和环境诊断命令。
- 安装和验证步骤必须记录在根目录文档中，不能依赖当前机器的隐含状态。

### R2. 最小代码结构

- 代码结构必须支持当前 CLI/核心库和未来 Electron 应用共用领域逻辑，但不得提前搭建完整桌面端。
- macOS 专属离线 OCR 实现必须位于可替换适配器边界之后，不能把 Apple Vision 类型泄漏到核心领域契约。
- 核心模块不得依赖 `open-design/` 中的源码、构建产物或运行时文件。

### R3. 环境诊断

- 提供可运行的环境诊断入口，检查 Node/pnpm、操作系统、CPU 架构、PowerPoint 和微软雅黑可用性。
- 微软雅黑缺失必须明确报告；不得静默选择备用字体。
- 诊断结果应适合人阅读，并能以结构化形式供后续任务使用。

### R4. 离线 OCR 技术探针

- 在 macOS 上验证至少一种不上传图片的 OCR 方案，输出文字内容、像素坐标、置信度和可用的旋转/方向信息。
- 首选候选为 Apple Vision，通过独立原生适配器向 TypeScript 核心输出稳定、可版本化的 JSON 契约。
- OCR 探针只验证可行性和输出归一化，不在 M0 实现段落合并、语义分类、人工校正或完整生产流水线。
- 如果 Apple Vision 无法满足简体中文、英文和坐标要求，必须记录证据并保留替换为其他离线 Provider 的边界。

### R5. 图片与 16:9 坐标基线

- 验证 PNG/JPEG 基本信息读取和 16:9 比例校验。
- 建立从源图像像素坐标到 PowerPoint 16:9 页面坐标的单一换算契约，并用测试覆盖边界和旋转无关的基础情况。
- 非 16:9 输入的容差必须固定且可测试；M0 不实现裁剪、拉伸或补边。

### R6. PPTX 最小兼容链路

- 使用 PptxGenJS 生成一个 16:9 PPTX 探针文件，至少包含全页背景图和一个微软雅黑原生文本框。
- 在 Microsoft PowerPoint for Mac 中验证文件可打开、文本可编辑、页面比例正确，并记录字体缺失时的实际行为。
- M0 不实现 OCR 到 PPTX 的完整自动连接，也不验证 clean plate 图像编辑质量。

### R7. 页面工作区与核心契约

- 定义最小页面工作区、阶段产物、Provider 运行记录和 `TextBlock` 领域契约。
- 契约必须表达图片中实际文字、像素边界、旋转、分类、候选来源、置信度和人工复核状态。
- 契约必须可版本化和运行时校验，为 M1 保存可编辑结构化文件奠定基础。

### R8. 质量与规范

- 新增代码必须通过类型检查、格式检查和自动化测试。
- 至少覆盖坐标换算、输入比例校验、契约校验和环境诊断中的稳定逻辑。
- 使用首批真实代码更新相关 Trellis backend 规范；frontend 规范在没有前端代码时不得虚构。
- 所有命令执行后必须确认 `open-design/` 没有改动。

## Acceptance Criteria

- [ ] 全新检出后可按照文档安装依赖并运行统一质量命令。
- [ ] 项目固定 Node.js LTS、pnpm 和 TypeScript/ESM 基线，当前非 LTS Node 环境会得到明确诊断。
- [ ] 最小 CLI 或等价入口可以运行环境诊断并输出人类可读及结构化结果。
- [ ] macOS 离线 OCR 探针能对受控中英文图片输出归一化文字块和像素坐标，或形成带证据的不可行结论与替代方案。
- [ ] PNG/JPEG 信息读取、16:9 校验和像素到 PowerPoint 坐标换算有自动化测试。
- [ ] PptxGenJS 探针文件可由 Microsoft PowerPoint for Mac 打开，文本框原生可编辑，页面为 16:9。
- [ ] 微软雅黑存在性会被预检；缺失时不静默回退。
- [ ] 页面工作区、阶段产物、Provider 记录和 `TextBlock` 契约可进行运行时校验并带版本字段。
- [ ] lint/format、type-check 和 test 全部通过。
- [ ] `.trellis/spec/backend/` 已根据真实实现补充最小规范，未虚构 frontend 约定。
- [ ] `open-design/` 无任何修改或生成文件。

## Out of Scope

- 完整 OCR/Layout 流水线、文字分组和对象内符号分类。
- clean plate、图像编辑 API 和 mask 生成。
- 完整的 OCR → 文本框 → PPTX 自动链路。
- Electron、React、SQLite、多页项目和任务调度。
- Windows/Linux 支持、任意页面比例和多字体识别。
