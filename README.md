# PPT Maker

PPT Maker 是一个本地优先的工具，目标是在保留页面视觉效果的同时，把图片中的独立版式文字恢复为 PowerPoint 原生可编辑文本。

当前处于 M0：项目骨架与技术基线。正式路线见 [ROADMAP.md](./ROADMAP.md)。

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

## 目录

```text
apps/cli/                     命令行入口和环境诊断
packages/core/                核心契约、校验和坐标换算
native/macos-vision-ocr/      Apple Vision 离线 OCR 探针
fixtures/foundation/          可公开提交的受控测试素材
```

`open-design/` 是外部只读参考目录，不属于 workspace、构建、格式化或测试范围。
