# M0 项目骨架与技术基线设计

## 1. 设计原则

- 最小可运行：只建立 M1 必需的骨架、契约和技术探针。
- 契约优先：平台专属实现位于适配器之后，核心数据不绑定 Apple Vision 或 PptxGenJS 类型。
- 证据驱动：OCR、字体和 PPTX 结论必须来自实际运行产物。
- 渐进演进：当前支持 CLI，未来增加 Electron 时复用核心包，不提前引入桌面运行时和数据库。
- 只读隔离：workspace、构建和格式化范围必须排除 `open-design/`。

## 2. 工具链决策

### 2.1 运行时

- Node.js 24 LTS，使用版本文件和 `engines` 固定。
- pnpm 10，根 `packageManager` 固定精确版本。
- TypeScript strict + ESM。
- 当前 Node.js 25 可以用于发现版本偏离，但正式验证应在 Node.js 24 环境执行。

### 2.2 质量工具

- TypeScript：类型检查与构建。
- Vitest：单元和契约测试。
- Biome：格式与静态检查，减少首期配置数量。
- `tsx` 或等价轻量执行器：开发期运行 TypeScript CLI。

具体依赖版本在实现时以 Node.js 24 兼容性为准，并写入 lockfile。

## 3. 最小仓库结构

```text
apps/
  cli/                     # 环境诊断和技术探针入口
packages/
  core/                    # 领域契约、坐标、校验、Provider 接口
native/
  macos-vision-ocr/        # Apple Vision 离线 OCR 适配器
fixtures/
  foundation/              # 可提交的小型受控测试素材
```

根 workspace 只包含本项目目录，明确排除 `open-design/`。M0 不创建空的 Electron、React、SQLite 或 daemon 包。

## 4. 模块与进程边界

### 4.1 TypeScript 核心

`packages/core` 负责：

- 16:9 输入校验和坐标换算。
- 版本化的 `TextBlock`、页面工作区和阶段记录 schema。
- OCR Provider 的平台无关接口。
- 环境诊断结果 schema。
- JSON 序列化、运行时校验和稳定错误类型。

### 4.2 CLI

`apps/cli` 提供最小命令：

```text
ppt-maker doctor [--json]
ppt-maker probe ocr <image> --output <file>
ppt-maker probe pptx --image <image> --output <file>
```

CLI 只编排核心接口和探针，不承载领域实现。

### 4.3 macOS Vision OCR

Swift 可执行程序负责调用 Vision，并通过标准输入/输出或明确文件参数交换 JSON。TypeScript 侧只认识版本化请求/响应：

```text
TypeScript CLI
  → JSON request + source image path
  → Swift Vision adapter
  → normalized JSON response
  → core schema validation
```

原生适配器不得修改输入图片，也不得把数据发送到网络。错误通过结构化 stderr/退出码或响应对象返回。

## 5. 核心数据契约

### 5.1 坐标

- 源图像像素坐标是识别和人工校正的权威坐标。
- PPTX 使用标准 wide 16:9 页面，换算只在合成边界发生。
- 所有 bbox 明确原点、单位和旋转方向；不得混用归一化坐标与像素坐标。

### 5.2 TextBlock

M0 契约至少包含：

- `schemaVersion`、`id`、`text`。
- `bboxPx`、`rotationDeg`、`confidence`。
- `classification`：`layout_text`、`object_integrated_symbol`、`uncertain`。
- `sources`：离线 OCR、云端候选或原始文案参考。
- `includeInMask`、`reviewStatus` 和修改元数据。

Apple Vision 探针可以只填充 OCR 能提供的字段，无法判断的字段使用显式未知值，不编造分类结果。

### 5.3 页面工作区

页面 manifest 至少记录：

- schema 版本、slide id、源图路径和哈希。
- 图像尺寸与比例校验结果。
- 阶段状态、输入哈希、尝试次数、工具/Provider 版本、开始结束时间和错误。
- 已产生资产的相对路径和内容哈希。

M0 只定义并测试 manifest，不实现完整阶段调度器。

## 6. 环境诊断

`doctor` 检查：

- Node.js 是否为支持的 24.x。
- pnpm 是否符合根配置。
- macOS 和 CPU 架构。
- Swift/Command Line Tools 是否可用。
- PowerPoint 应用是否存在。
- 微软雅黑 family/PostScript 名称是否可用。

诊断项状态为 `pass`、`warn` 或 `fail`。Node 版本偏离和缺失微软雅黑必须明确显示；是否阻止某个具体探针由命令自身根据需求决定。

## 7. 技术探针

### 7.1 OCR

使用受控的简体中文、英文和混排 16:9 小图，验证：

- 识别文本。
- bbox 到原图像素坐标的换算。
- 置信度。
- Vision 可提供的方向/旋转信息。
- 相同输入重复运行的输出稳定性。

旋转艺术字、分组和对象内符号分类留给 M1；M0 只记录 Vision 的原始能力边界。

### 7.2 图片

验证 PNG/JPEG 的尺寸、格式和 16:9 容差。图片库只用于元数据与探针，不在 M0 实现图像修复。

### 7.3 PPTX

使用 PptxGenJS 创建标准 16:9 页面，铺设测试背景图并叠加微软雅黑文本框。保存产物供 PowerPoint for Mac 人工验证，同时用自动化测试检查生成文件存在、非空和关键配置路径执行成功。

## 8. 兼容性与安全

- 首期只支持 macOS；Apple Vision 适配器不承诺跨平台。
- 核心接口必须允许未来增加 Windows/PaddleOCR 等 Provider。
- CLI 只读取显式传入的文件，输出写入显式路径或受控工作目录。
- 不自动下载字体、OCR 模型或调用云端服务。
- fixtures 必须可公开提交，不包含敏感或授权不明素材。

## 9. 演进与回滚

- Apple Vision 不满足需求时，保留核心契约和 CLI，替换 OCR 适配器。
- PptxGenJS 字体或版面行为不满足时，保留坐标/工作区契约，记录实验并在 M1 前调整合成实现。
- pnpm workspace 只创建有真实代码的包，避免空目录和过早分层。
- 任一探针失败不阻止保存研究证据；不得为了让检查通过而伪造成功输出。
