# M0 当前环境基线

记录日期：2026-07-20

## 仓库状态

- 除 `.trellis/` 等工作流文件外，当前产品仓库只有 `AGENTS.md`、`ROADMAP.md`、`OPEN-DESIGN-REFERENCE.md` 和 `PPT-APP-OPEN-DESIGN-ANALYSIS.md`。
- 不存在根 `package.json`、pnpm workspace、TypeScript、lint 或测试配置。
- `open-design/` 是只读参考，不纳入本项目 workspace。

## 本机环境

| 项目 | 观测值 |
|---|---|
| 操作系统 | macOS 26.4（Build 25E246） |
| CPU | arm64 / Apple Silicon |
| Node.js | 25.6.1 |
| npm | 11.9.0 |
| pnpm | 10.32.0 |
| Corepack | 当前 shell 不可用 |
| Python | 3.14.4 |
| Swift | 6.2.3 |
| Xcode Command Line Tools | `/Library/Developer/CommandLineTools` |
| Microsoft PowerPoint | `/Applications/Microsoft PowerPoint.app` 存在 |
| Tesseract | 当前 PATH 中未发现 |
| ImageMagick | 当前 PATH 中未发现 |
| 微软雅黑 | PowerPoint 应用包内包含 `msyh.ttc`、`msyhbd.ttc`、`msyhl.ttc` |

## 初步判断

- 当前 Node.js 25 不是应当写入项目约束的长期基线，M0 应固定 Node.js 24 LTS，并在诊断中提示版本偏离。
- pnpm 10 已可用，可以通过 `packageManager` 字段和版本文件固定，不依赖当前缺失的 Corepack。
- Swift 与 Apple Vision 是 macOS 离线 OCR 的低依赖首选探针，适合通过 JSON 边界接入 TypeScript。
- Python 3.14 可能限制部分 OCR/深度学习包的现成 wheel，不应在没有兼容性实验前把 Python OCR 设为首选主路径。
- PowerPoint 已安装，可以进行真实 PPTX 打开和编辑验证。
- PowerPoint 自带微软雅黑字体资源；M0 的可靠预检应检查应用包字体路径，不能依据 Spotlight 结果直接下结论。

## 待验证项

- Apple Vision 对简体中文、英文、混排、坐标和方向信息的实际输出。
- PptxGenJS 生成文件在当前 PowerPoint 中的 16:9、背景图和原生文本表现。
- 已验证 PptxGenJS 使用 `Microsoft YaHei`，PowerPoint 文本 API 返回东亚字体和 ASCII 字体均为该名称。
- PNG/JPEG 读取库在 Node.js 24 arm64 环境中的安装和运行情况。

## Node.js 24 复核

- 使用 Node.js 24.18.0 运行 core 与 CLI 全部 14 项测试，结果全部通过。
- `doctor` 在 Node.js 24 环境下 6 项检查全部通过；当前系统 Node.js 25.6.1 会按设计产生明确警告。
- `pnpm install --frozen-lockfile` 可根据已提交 lockfile 重建依赖；无 TTY 自动化环境需要设置 `CI=true`。
