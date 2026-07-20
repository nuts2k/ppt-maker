# M0 技术探针结果

记录日期：2026-07-20

## 环境诊断

正式 CLI：

```bash
pnpm ppt-maker doctor
pnpm ppt-maker doctor --json
```

结果：5 项通过、1 项警告、0 项失败。

- pnpm 10.32.0：通过。
- macOS arm64：通过。
- Swift 6.2.3：通过。
- Microsoft PowerPoint：通过。
- Microsoft YaHei：通过。字体位于 PowerPoint 应用包的 `Contents/Resources/DFonts/msyh.ttc`。
- Node.js 25.6.1：警告。项目基线为 Node.js 24 LTS，诊断能够明确显示偏离。

在 Node.js 24.18.0 环境复核时，6 项检查全部通过；core 与 CLI 共 14 项测试也全部通过。

## 受控图片

`fixtures/foundation/mixed-text.png` 和 `mixed-text.jpg` 由仓库内 Swift 脚本生成：

- PNG RGBA 与 JPEG 两种格式。
- 1600 × 900。
- 精确 16:9。
- 包含简体中文、英文、数字和带容器文字。
- 素材由本项目生成，不包含外部授权内容。

图片探针正确读取格式、尺寸和比例，并返回 0 宽高比误差。

## Apple Vision 离线 OCR

正式 CLI：

```bash
pnpm probe:ocr fixtures/foundation/mixed-text.png --output artifacts/ocr.json
```

受限沙箱内无法访问 macOS Vision 系统服务，会返回 Foundation GenericObjCError；在正常 macOS 用户环境中运行成功，全程未调用网络 OCR。

归一化结果：

| 块 | 识别文字 | 置信度 | 坐标 |
|---|---|---:|---|
| `vision-0` | `你好，PPT Maker` | 1.0 | 返回原图像素 bbox |
| `vision-1` | `Editable slides• 2026` | 0.5 | 返回原图像素 bbox |

结论：

- Apple Vision 能识别受控简体中文、英文和混排文本，并提供可换算的 bbox 与置信度。
- 英文中点附近的空格与标点和原图存在轻微差异，证明 OCR 结果不能直接视为最终真值，M1 仍需人工复核。
- 当前 API 未直接提供可靠文字旋转角度，响应使用显式 `rotationDeg: null`；旋转分析需要 M1 的额外策略。
- Vision 首次冷启动在当前自动化环境中较慢，M1 应记录实际耗时，并评估常驻进程或批处理是否有必要。
- Apple Vision 保持在 Provider 边界内是正确选择；不应把其坐标或请求类型泄漏到核心契约。

## PptxGenJS 与 PowerPoint

正式 CLI：

```bash
pnpm probe:pptx fixtures/foundation/mixed-text.png --output artifacts/foundation.pptx
```

自动检查：

- 文件为有效 ZIP/PPTX，包含 1 张图片媒体和 1 页幻灯片。
- `presentation.xml` 页面尺寸为 wide 16:9。
- `slide1.xml` 包含文本 `你好，PPT Maker / Editable Text` 和 `Microsoft YaHei` 字体声明。

Microsoft PowerPoint for Mac 实际验证：

- `foundation.pptx` 成功打开。
- 文档包含 1 页、2 个形状。
- 第二个形状为 `has text frame: true` 的 PowerPoint 原生文本框。
- PowerPoint 文本 API 能读取完整文本内容。
- 字体属性为 `Microsoft YaHei`，东亚字体和 ASCII 字体也均为 `Microsoft YaHei`，字号 24pt。

Quick Look 缩略图会把新增文本预览成替代字体，但 PowerPoint 内部实际字体属性正确；后续视觉评测必须以 PowerPoint 为准，不能把 Quick Look 字体渲染当作权威结果。

## 构建与沙箱

- Swift/Clang 模块缓存已定向到 `native/macos-vision-ocr/.build/module-cache`，普通构建不再依赖用户级 `~/.cache` 写权限。
- Apple Vision 运行仍需要访问 macOS 系统视觉服务；这是运行环境权限边界，不是网络依赖。
- `artifacts/`、TypeScript `dist/` 和原生 `.build/` 均被 Git 忽略。
