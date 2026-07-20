# PPT Maker

PPT Maker 是一个本地优先的工具，目标是在保留页面视觉效果的同时，把图片中的独立版式文字恢复为 PowerPoint 原生可编辑文本。

当前处于 M1：单页图片转可编辑 PPTX 原型。正式路线见 [ROADMAP.md](./ROADMAP.md)。

## 环境要求

- macOS（首期基准平台）
- Node.js 24 LTS
- pnpm 10
- Xcode Command Line Tools / Swift
- Microsoft PowerPoint for Mac

仓库使用 `.node-version` 和 `.nvmrc` 固定 Node.js 主版本。`package.json` 固定 pnpm 精确版本。

## 安装与检查

```bash
pnpm install
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

当前机器可以运行：

```bash
pnpm build
pnpm ppt-maker doctor
pnpm ppt-maker doctor --json
```

## 技术探针

生成受控测试图：

```bash
pnpm fixture:foundation
```

离线 OCR：

```bash
pnpm build:vision
pnpm probe:ocr fixtures/foundation/mixed-text.png --output artifacts/ocr.json
```

PPTX：

```bash
pnpm probe:pptx fixtures/foundation/mixed-text.png --output artifacts/foundation.pptx
```

探针产物写入 `artifacts/`，该目录不提交。

## M1 单页流水线

一条完整的单页流水线从 16:9 源图到 PowerPoint for Mac 可编辑 PPTX，在上传和人工门处停下等待开发者确认。人工门是流水线的一等公民：候选文字复核、clean plate 接受、PPTX 接受都必须由开发者显式完成。

```bash
pnpm build            # 构建 CLI 与 Vision 二进制
pnpm build:vision

# 1. 建立单页工作区（校验 16:9）
pnpm ppt-maker slide init fixtures/single-slide/complex-page.png --workspace artifacts/slide

# 2. 离线 Apple Vision OCR（完全离线）
pnpm ppt-maker slide ocr artifacts/slide

# 3.（可选）显式云端视觉分析，补充旋转/漏字/分类候选——必须显式确认上传
pnpm ppt-maker slide analyze --confirm-upload artifacts/slide

# 4. 合并候选，生成可编辑复核文件 stages/review/text-blocks.json
pnpm ppt-maker slide review artifacts/slide
#    【人工门】编辑 text-blocks.json：确认文字内容、分类（版式文字/对象内符号/不确定）、
#    是否参与 mask、复核状态、必要的样式与 mask 参数。

# 5. 校验复核文件（违规非零退出，作为 mask/clean 的门禁锚点）
pnpm ppt-maker slide validate-review artifacts/slide

# 6. 从已复核结构化数据派生字形 mask、预览与覆盖率统计（离线）
pnpm ppt-maker slide mask artifacts/slide

# 7. gpt-image-2 生成 clean plate 底板——必须显式确认上传源图与 mask
pnpm ppt-maker slide clean --confirm-upload artifacts/slide

# 8.【人工门】核对 clean plate 无文字残留、容器与对象内符号完整后接受
pnpm ppt-maker slide accept-clean artifacts/slide --by "$(whoami)" --note "容器与符号完整"

# 9. 合成 16:9 微软雅黑可编辑 PPTX 并做自动检查（ZIP/XML/比例/文字/字体/形状）
pnpm ppt-maker slide pptx artifacts/slide

# 10.【人工门】在 Microsoft PowerPoint for Mac 打开，确认 16:9、可编辑、字体与排版后接受
pnpm ppt-maker slide accept-pptx artifacts/slide --by "$(whoami)" --note "PowerPoint for Mac 已确认"

# 11. 分阶段报告（自动检查与人工接受分开呈现，未完成不汇总为成功）
pnpm ppt-maker slide report artifacts/slide
```

增量重跑：`slide run --from <stage>` 按 DAG 顺序执行本地阶段，遇到上传门（analyze/clean）和人工门（复核编辑、accept-clean、accept-pptx）会停止并提示下一步。变更粒度遵循 design §6：只改文字内容/样式只重跑 PPTX；改几何/分类/mask 参与/mask 参数会重跑 mask、clean 和 PPTX。

```bash
# 人工编辑 text-blocks.json 后，自动执行到下一道门
pnpm ppt-maker slide run --from validate-review artifacts/slide
```

## 目录

```text
apps/cli/                     命令行入口和环境诊断
packages/core/                核心契约、校验和坐标换算
native/macos-vision-ocr/      Apple Vision 离线 OCR 探针
fixtures/foundation/          可公开提交的受控测试素材
fixtures/single-slide/        M1 合成复杂页 fixture（pnpm fixture:single-slide 可复现）
```

`open-design/` 是外部只读参考目录，不属于 workspace、构建、格式化或测试范围。
