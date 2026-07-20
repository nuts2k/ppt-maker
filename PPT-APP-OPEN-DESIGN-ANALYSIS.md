# PPT 桌面应用构思与 Open Design 借鉴分析

> 本文记录本项目的初步产品构思、对 `open-design/` 的只读调研结果，以及建议的技术架构与 MVP 验证路径。
>
> `open-design/` 仅作为外部参考，不是本项目的代码基础。所有后续实现均应位于 `open-design/` 之外。

## 1. 产品目标

本项目计划开发一个专注于生成 PPT 的桌面应用，而不是复刻 Open Design 的通用设计平台。

初步工作流如下：

```text
内容策划
  → 页面内容规格
  → 逐页调用 GPT Image 等 API 生成完整设计图
  → 识别图中的文字、位置和排版信息
  → 基于原图生成移除文字后的 clean plate
  → 将 clean plate 与原生可编辑文字框合并
  → 导出可继续编辑的 PPTX
```

产品的核心价值不是“把一张图片放进 PPT”，而是在尽量保留 AI 图片视觉效果的同时，将其中的文字恢复为 PowerPoint 原生可编辑文本。

## 2. 总体判断

Open Design 不适合作为本项目的直接代码基础，但适合作为架构参考和零件仓库。

适合借鉴的主要部分：

- Electron 桌面安全边界。
- 本地 daemon 与 SQLite 持久化方式。
- 异步媒体任务状态模型。
- 图像生成 API 的 provider 适配、安全检查和重试策略。
- PptxGenJS 的页面比例和图片型 PPTX 导出实现。
- daemon 与 Electron 之间通过文件路径传递大文件的方式。
- Deck 内容策划、叙事结构、视觉节奏和自检方法。

不适合继承的部分：

- 通用 Agent CLI 运行时。
- MCP、插件市场、设计系统注册中心和社区能力。
- 面向多种设计产物的通用项目模型。
- Next.js sidecar、云端部署和复杂发布体系。
- 以 HTML Deck 作为核心产物的工作流。
- 面向任意 HTML/CSS 的通用 `dom-to-pptx` 转换路线。

## 3. 可借鉴部分概览

| Open Design 部分 | 借鉴程度 | 在本项目中的用途 |
|---|---:|---|
| Electron 安全架构 | 高 | 桌面壳、文件对话框、有限 IPC |
| 本地 daemon + SQLite | 高 | 项目、页面、任务和资产持久化 |
| 异步媒体任务模型 | 高 | 逐页生成、OCR、去字和导出 |
| GPT Image/provider 适配 | 中高 | 图片生成、图片编辑、限流处理 |
| PptxGenJS 导出 | 高 | clean plate + 可编辑文本框 |
| 大文件路径传递 | 高 | 避免通过 JSON/Base64 IPC 传输 4K 图片 |
| Deck 内容策划方法 | 中高 | 内容大纲、叙事结构和逐页视觉说明 |
| HTML Deck 框架 | 低 | 仅适合参考预览和固定画布概念 |
| `dom-to-pptx` | 低 | 固定图层模型下不如直接使用 PptxGenJS |
| Agent、插件、MCP | 不建议 | 超出专用 PPT 应用范围 |

## 4. 本地 daemon 与持久化

### 4.1 参考位置

- `open-design/apps/daemon/src/db.ts`
- `open-design/apps/daemon/src/media/tasks.ts`
- `open-design/apps/daemon/src/media/task-store.ts`
- `open-design/apps/daemon/src/routes/media.ts`

### 4.2 值得借鉴的设计

- SQLite 使用 WAL 和外键。
- 数据库保存索引和元数据，实际图片保存在项目资产目录。
- 任务状态使用：

```text
queued → running → done / failed / interrupted
```

- daemon 重启后将未完成任务标记为 `interrupted`。
- 前端可以按增量读取任务进度。
- 单个任务失败不会丢失已经生成的文件。

### 4.3 本项目需要的改进

Open Design 的媒体任务仍然主要依赖进程内 Promise 和 Map，不是真正的持久任务队列。本项目需要阶段级恢复和幂等能力。

建议将每一页拆成以下阶段：

```text
generate_source
  → recognize_text
  → generate_clean_plate
  → analyze_style
  → compose_slide
  → validate
```

每个阶段至少保存：

- `input_hash`
- `attempt`
- `model`
- `prompt`
- `status`
- `asset_id`
- `error`
- `usage/cost`
- `started_at`
- `ended_at`

这样可以做到：

- OCR 失败时不重新生成原图。
- clean plate 失败时只重跑去字阶段。
- PPTX 导出失败时不重新调用图片 API。
- 应用重启后可以从失败页面和失败阶段继续。

## 5. 图像生成与编辑适配

### 5.1 参考位置

- `open-design/apps/daemon/src/media/index.ts`
- `open-design/apps/daemon/src/media/models.ts`
- `open-design/apps/daemon/src/media/config.ts`
- `open-design/apps/daemon/src/media/image-generation-retry.ts`

### 5.2 值得借鉴的设计

- provider 与 model 分层。
- API Key 保存在本地，读取设置时进行脱敏。
- 允许配置自定义 base URL 和模型别名。
- 引用图只允许来自项目目录，防止上传任意本地文件。
- 对图片格式和大小进行白名单限制。
- 长时间图像请求使用独立超时设置。
- 统一将返回的图片落盘到项目资产目录。

Open Design 对付费图片请求的重试策略尤其值得保留：

- 只对明确返回的 `429` 和 `503` 重试。
- 网络连接异常不自动重试。
- 避免服务端已经接收并计费，但客户端因断线再次提交相同请求。

### 5.3 当前实现的限制

`open-design/apps/daemon/src/media/models.ts` 将 `gpt-image-2` 标记为支持 `t2i`、`i2i` 和 `inpaint`，但官方 OpenAI provider 分支主要实现的是图片生成。

有参考图时切换到 `/images/edits` 的实现主要位于自定义 OpenAI-compatible provider 分支中。因此，不能直接把 Open Design 的模型能力声明视为一套完整的官方 GPT Image 去字实现。

本项目需要单独实现正式的图片编辑适配层：

```ts
interface ImageProvider {
  generate(input: GenerateImageInput): Promise<ImageResult>;
  edit(input: EditImageInput): Promise<ImageResult>;
}
```

编辑输入应支持：

- 原始图片。
- 可选文字区域 mask。
- 去字提示词版本。
- 输出尺寸和质量。
- 候选图片数量。
- 模型和 provider 参数。

## 6. OCR、版面识别与文字还原

对 Open Design 的准确判断是：它存在 OCR 相关的数据结构、模型目录和外部工具入口，但当前仓库没有内置、自动运行的 OCR 流水线。

已有的 OCR 相关表面包括：

- `packages/contracts/src/api/library.ts` 在素材对象中预留了 `ocrText`。
- `apps/daemon/src/library-store.ts` 在数据库中预留了 `ocr_text` 字段。
- `skills/fal-vision/SKILL.md` 描述了可通过外部 fal.ai 视觉工具运行 OCR。
- `apps/daemon/src/mcp-config.ts` 收录了带 OCR 能力的外部 MCP 工具说明。
- 模型目录中可能出现 OCR 模型，但模型目录条目不等于 daemon 已经实现了调用和结果归一化。

`apps/daemon/src/library.ts` 明确说明 AI enrichment 中的 caption、OCR 和 embedding 尚未包含在当前实现中。素材注册时，这些阶段会被记录为：

```text
ai: caption/ocr/embedding skipped (no model configured)
```

因此，Open Design 当前可以通过额外安装和配置的 Skill、MCP 或 provider，让 Agent 临时调用外部 OCR；但这不属于 Open Design 自带的稳定 OCR 服务。

Open Design 的 PPT 导出也不依赖 OCR：截图型导出直接把整页图片放进 PPTX；可编辑型导出则从已知的 HTML DOM 节点转换文字和形状。

本项目仍需自主实现以下能力：

- OCR provider。
- 带坐标的文字块数据结构。
- 文字行与段落合并。
- 阅读顺序识别。
- 字体、字号、字重、颜色和对齐推断。
- OCR 框人工校正 UI。
- OCR 结果到 PowerPoint 文本框的映射。

核心区别可以概括为：

| 能力 | Open Design 当前状态 |
|---|---|
| 保存 OCR 纯文本 | 数据结构已预留 |
| 自动对素材库运行 OCR | 当前未实现，任务被标记为 skipped |
| Agent 通过外部工具执行 OCR | 可以，但需要额外配置 Skill/MCP/provider |
| PPT 图片 OCR | 没有 |
| OCR bounding boxes | 没有统一实现 |
| OCR 到 PowerPoint 文本框 | 没有 |
| 字体、颜色和字号推断 | 没有 |
| OCR mask 与 clean plate 流水线 | 没有 |

### 6.1 建议的数据结构

```ts
interface TextBlock {
  id: string;

  // 内容策划阶段确定的权威文字
  sourceText: string;

  // 从图片中实际识别出的文字
  recognizedText: string;

  // 使用原图像素坐标，导出时再换算为 PPT 坐标
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  rotation: number;
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  lineHeight?: number;
  letterSpacing?: number;
  confidence: number;
  manuallyReviewed: boolean;
}
```

### 6.2 权威文字来源

内容设计阶段已经知道每页应该出现的正确文案，因此不应把 OCR 文字作为最终内容来源。

更可靠的关系是：

```text
内容规格中的预定文案
  = 最终文字内容的权威来源

OCR / 视觉版面识别
  = 位置、分组、换行、旋转和样式的参考来源
```

图片模型可能生成错字、伪文字或漏字。如果直接将 OCR 结果写回 PPT，会把图片模型的错误固化到最终文件中。

系统应将 OCR 块与页面的 `mustKeepText` 或预定文案做匹配，再用正确文案替换识别文本。

## 7. Clean plate 生成

“让模型移除所有文字，同时保持其他像素完全不变”是整个流程中最不稳定的阶段。

可能出现的问题：

- 文字附近的纹理被重绘。
- 图标、人物、Logo 或图表发生漂移。
- 小字没有被完全清除。
- 图表中的标签和真正的图形元素难以区分。
- 模型重新生成了类似文字的伪纹理。

### 7.1 建议流程

```text
OCR / 文字检测
  → 合并文字行和段落
  → 对文字 bbox 做适度扩张
  → 生成 mask
  → 调用图片编辑 API
  → 一次生成多个 clean plate 候选
  → 再次 OCR，检查文字残留
  → 对比 mask 外区域，检测结构漂移
  → 自动选择或交给用户选择候选
```

### 7.2 必须保存的中间产物

- 原始生成图。
- OCR 原始返回。
- 归一化文字块。
- 文字 mask。
- clean plate 候选。
- 最终选择的 clean plate。
- 去字提示词和模型参数。
- 质量验证结果。

### 7.3 降级策略

以下内容不应强制转换为可编辑文字：

- 复杂图表中的密集标签。
- 数学公式。
- 手写字和特殊字形。
- Logo 和品牌字标。
- OCR 低置信度且无法与预定文案匹配的区域。

必要时可以保留为局部位图；极端情况下允许整页回退为不可编辑背景图。

## 8. PPTX 组装

### 8.1 参考位置

- `open-design/apps/daemon/src/deck-export.ts`
- `open-design/apps/desktop/src/main/deck-capture.ts`
- `open-design/apps/daemon/src/import-export-routes.ts`

### 8.2 可直接借鉴的部分

`buildScreenshotPptx()` 已经处理：

- PptxGenJS 初始化。
- 标准 16:9 页面。
- 自定义页面比例。
- 每页全尺寸背景图。
- Node Buffer 输出。
- PNG/JPEG 数据处理。

Open Design 当前的截图型导出是：

```text
PPT slide = 一张全屏图片
```

本项目需要扩展为：

```text
PPT slide
  ├─ 全屏 clean plate
  ├─ 可编辑标题文本框
  ├─ 可编辑正文文本框
  ├─ 必要的局部位图
  └─ 可选备注和页面元数据
```

示意代码：

```ts
slide.addImage({
  path: cleanPlatePath,
  x: 0,
  y: 0,
  w: slideWidth,
  h: slideHeight,
});

for (const block of textBlocks) {
  slide.addText(block.sourceText, {
    x: pixelToSlideX(block.bbox.x),
    y: pixelToSlideY(block.bbox.y),
    w: pixelToSlideX(block.bbox.width),
    h: pixelToSlideY(block.bbox.height),
    fontFace: block.fontFamily,
    fontSize: pixelFontSizeToPoint(block.fontSizePx),
    color: block.color,
    bold: block.fontWeight ? block.fontWeight >= 600 : false,
    align: block.align,
    valign: block.verticalAlign,
    rotate: block.rotation,
    margin: 0,
  });
}
```

### 8.3 为什么不优先采用 `dom-to-pptx`

Open Design 的可编辑导出路线是：

```text
HTML DOM → dom-to-pptx → PowerPoint 原生对象
```

该方案适用于任意 HTML/CSS，但存在 CSS 到 PowerPoint 映射误差。本项目的对象类型非常有限，主要是背景图、文本框和少量图片块，因此直接使用 PptxGenJS 更可控。

## 9. Electron 与本地服务边界

### 9.1 参考位置

- `open-design/apps/desktop/src/main/index.ts`
- `open-design/apps/desktop/src/main/preload.cts`
- `open-design/packages/sidecar-proto/src/index.ts`
- `open-design/apps/desktop/src/main/deck-capture.ts`

### 9.2 值得借鉴的原则

- Renderer 不直接获得 Node.js 和任意文件系统能力。
- preload 只暴露少量类型化命令。
- 本地服务负责数据库、任务和资产管理。
- Electron Main 负责文件选择、另存为、打开目录等系统能力。
- 大图片和 PPTX 使用文件路径传递，而不是塞进 IPC JSON。

对于几十页 4K 图片，Base64 会显著增加内存占用和 IPC 传输开销。建议使用：

```text
服务创建受控临时目录
  → worker 写入图片或 PPTX
  → IPC 只返回路径和元数据
  → 服务校验路径
  → 使用完成后清理临时目录
```

### 9.3 MVP 进程模型

首版不必照搬 Open Design 的多 sidecar 体系，可以先使用：

```text
Electron Main
  ├─ React Renderer
  └─ Node Worker / Local Service
```

当任务恢复、崩溃隔离和独立升级成为实际需求后，再将 Local Service 拆成独立 daemon。

## 10. 内容设计和视觉方法

### 10.1 参考位置

- `open-design/design-templates/simple-deck/SKILL.md`
- `open-design/design-templates/html-ppt/SKILL.md`
- `open-design/packages/contracts/src/prompts/deck-framework.ts`
- `open-design/design-systems/`

### 10.2 值得提炼的方法

- 先明确受众、场景和决策目标。
- 收集必须保留的数据、事实和原始材料。
- 先生成整套叙事结构，再开始逐页设计。
- 每一页都应有明确的页面作用。
- 区分封面、章节页、主观点页、数据页、对比页和结尾页。
- 预先安排视觉节奏，避免连续多页结构完全相同。
- 为不同类型 PPT 定义不同的 critic rubric。
- 先确认大纲和页面内容，再执行昂贵的图片生成。

### 10.3 建议的内容规格

```json
{
  "title": "产品发布方案",
  "audience": "公司管理层",
  "goal": "批准第一阶段预算",
  "aspectRatio": "16:9",
  "styleGuide": {
    "mood": "克制、专业、具有编辑感",
    "palette": ["#111111", "#F5F1E8", "#D9633B"],
    "typography": "高对比标题，简洁正文"
  },
  "slides": [
    {
      "index": 1,
      "role": "cover",
      "headline": "重新定义团队知识流动",
      "body": [],
      "visualIntent": "深色背景、单一视觉中心、大标题",
      "mustKeepText": ["重新定义团队知识流动"]
    }
  ]
}
```

逐页图片生成应同时接收：

- 全局 style guide。
- 当前页面 content spec。
- 相邻页面的视觉节奏信息。
- 必须准确出现的文案。
- 页面角色和信息层级。

## 11. 页面预览与人工校正 UI

### 11.1 参考位置

- `open-design/apps/web/src/components/DeckThumbnailRail.tsx`

Open Design 的缩略图轨道采用按需挂载思路，只渲染当前页面及视窗附近页面，避免大量页面预览同时占用内存和 GPU。

### 11.2 建议界面

```text
左侧
  页面缩略图
  页面生成状态
  OCR / clean plate 失败标记

中间
  原图或 clean plate
  可选对比滑杆
  OCR 文字框
  低置信度区域
  拖拽和缩放文字框

右侧
  权威页面文案
  字体、字号、颜色和对齐
  clean plate 候选
  重新识别
  重新去字
  页面级导出预览
```

人工校正界面不是附属功能，而是图片生成方案的重要可靠性保障。

## 12. 建议的项目数据模型

```text
Project
  └─ Deck
       └─ Slide
            ├─ content_spec
            ├─ source_image
            ├─ ocr_result
            ├─ text_blocks
            ├─ text_mask
            ├─ clean_plate_candidates
            ├─ selected_clean_plate
            ├─ generation_versions
            └─ validation_result
```

建议的核心实体：

```text
projects
decks
slides
jobs
job_stages
assets
text_blocks
generation_versions
validation_results
exports
```

图片等二进制文件存放在项目资产目录，SQLite 保存：

- 路径。
- MIME 类型。
- 尺寸。
- 内容 hash。
- 来源阶段。
- 模型与生成参数。
- 版本关系。

## 13. 建议的整体架构

```text
Electron + React
  ├─ 项目列表
  ├─ 内容大纲编辑
  ├─ 逐页生成状态
  ├─ 原图 / clean plate 对比
  ├─ OCR 文字框校正
  └─ PPTX 导出

Local PPT Service
  ├─ SQLite
  ├─ Job Scheduler
  ├─ Asset Store
  ├─ Image Provider
  │    ├─ generate()
  │    └─ edit()
  ├─ Layout Recognizer
  ├─ Clean Plate Generator
  ├─ Slide Validator
  └─ Pptx Composer
```

建议各模块保持明确边界：

```ts
interface LayoutRecognizer {
  recognize(input: RecognizeInput): Promise<RecognizeResult>;
}

interface CleanPlateGenerator {
  generate(input: CleanPlateInput): Promise<CleanPlateCandidate[]>;
}

interface SlideValidator {
  validate(input: ValidateSlideInput): Promise<SlideValidationResult>;
}

interface PptxComposer {
  compose(deckId: string, outputPath: string): Promise<ExportResult>;
}
```

## 14. MVP 验证顺序

最危险的部分不是桌面 UI，而是图片到可编辑 PPT 的还原质量。

建议首先制作单页命令行原型：

```text
输入
  source.png
  expected-content.json

输出
  ocr-raw.json
  text-blocks.json
  mask.png
  clean-candidate-1.png
  clean-candidate-2.png
  selected-clean.png
  result.pptx
  comparison.png
```

第一阶段重点验证：

1. 中文 OCR 的 bbox、换行和段落分组准确率。
2. OCR 块与预定文案的匹配准确率。
3. clean plate 能否去除文字而不破坏其他区域。
4. PowerPoint 中字体、字号和换行是否接近原图。
5. 哪些类型页面必须降级为局部或整页位图。

建议先使用 20～50 张不同风格页面建立评测集，包括：

- 中文标题页。
- 中英文混排。
- 浅色和深色背景。
- 渐变和复杂纹理背景。
- 大标题和密集正文。
- 图表和数据页。
- 特殊角度、旋转文字。
- 字体和图片重叠的页面。

达到可接受成功率后，再开发完整桌面应用。

## 15. 初步技术取舍

### 建议采用

- Electron。
- React + Vite Renderer。
- TypeScript。
- SQLite + `better-sqlite3`。
- PptxGenJS。
- 本地文件资产库。
- 后台任务阶段机。
- GPT Image/provider adapter。
- 可替换的 OCR/Layout provider。

### 暂不采用

- Next.js sidecar。
- Open Design 的通用 Agent runtime。
- MCP。
- 插件系统和 marketplace。
- 通用设计系统注册中心。
- HTML Deck 作为核心中间格式。
- `dom-to-pptx` 作为首版导出引擎。
- 云端部署体系。

## 16. 大模型 API 与 Agent CLI 的能力边界

### 16.1 不接 Agent CLI 仍然可以完整使用大模型

Agent CLI 不是大模型本身，也不是访问大模型的必要条件。应用可以直接通过 provider API 使用：

- 文本生成。
- 多模态视觉理解。
- 图片生成和图片编辑。
- 结构化 JSON 输出。
- Function Calling / Tool Calling。
- 流式输出。
- 多轮对话。
- 内容规划、批评和质量验证。

两者的关系可以理解为：

```text
模型 API
  = 推理、生成、视觉理解、结构化输出、工具调用请求

Agent CLI
  = 模型 API
    + 本地文件系统
    + 终端命令
    + 工具执行循环
    + 上下文收集
    + Skills / MCP
    + 会话恢复
    + 权限与沙箱
```

Open Design 自身也有不依赖 Agent CLI 的 BYOK API proxy，并在部分 OpenAI-compatible provider 路径中实现了 daemon 侧工具调用循环。这说明“直接 API + 应用自己执行工具”本身就是可行路线。

### 16.2 不接 Agent CLI 会失去的能力

#### 复用 CLI 登录和订阅

直接 API 通常需要用户配置 API Key，并使用独立的 API 计费。不能默认将 ChatGPT、Codex、Claude 等产品订阅额度视为 API 额度。

#### 任意本地操作

Agent CLI 通常可以搜索整个目录、读取和修改任意文件、执行 shell 命令、调用 MCP，并根据执行结果继续迭代。

直接 API 只能提出工具调用请求，应用需要自行决定开放哪些工具并执行它们。

#### 现成工具循环

Agent CLI 通常已经实现：

```text
模型请求
  → 返回 tool call
  → 执行工具
  → 将工具结果返回模型
  → 模型继续判断
  → 直到完成
```

不使用 CLI 时，本项目需要实现一个轮数受限的工具编排器。

#### Skills 与 MCP 生态

Open Design 的 Skills、Agent 配置和 MCP 工具不能自动继承。真正有价值的规则可以整理为应用内 prompt、template、rubric 或 provider adapter。

#### 开放式自主任务

Agent CLI 更适合“阅读一个目录、自己选择工具、研究缺失信息、修改文件并反复修正”这类开放任务。

直接 API 更适合本项目的确定性流程：

```text
读取指定材料
  → 输出 deck_spec
  → 用户确认
  → 生成 slide_spec
  → 逐页生成
  → OCR
  → clean plate
  → 验证
  → 导出
```

### 16.3 推荐的受控 Agent 模式

本项目的核心流程建议直接调用 API，同时实现一个只允许调用 PPT 领域白名单工具的“窄 Agent”。

```text
Model Gateway
  ├─ planDeck()
  ├─ writeSlideContent()
  ├─ createVisualPrompt()
  ├─ analyzeLayout()
  ├─ matchOcrToSourceText()
  ├─ critiqueDeck()
  └─ validateSlide()

Application Tools
  ├─ readUploadedDocument()
  ├─ searchProjectMaterials()
  ├─ getDeckSpec()
  ├─ getSlideSpec()
  ├─ updateSlideContent()
  ├─ generateSlideImage()
  ├─ recognizeSlideText()
  ├─ generateCleanPlate()
  └─ saveRevision()
```

工具调用循环应设置严格上限，例如每次任务最多 2～4 轮，避免不可控的无限执行。

核心流程不开放：

- 任意 shell。
- 任意文件系统读写。
- 自动安装依赖。
- 修改应用代码。
- 未经确认访问项目目录之外的文件。

### 16.4 Agent CLI 的产品定位

Agent CLI 可以作为后期可选高级模式，而不是 MVP 的基础依赖：

```text
标准模式
  直接 API + 受控工具
  稳定、轻量、可预测

高级 Agent 模式
  可选连接 Codex、Claude Code 或 OpenCode
  用于大型资料目录、开放式研究和扩展工作流
```

不让核心流程依赖 Agent CLI，可以避免：

- 用户必须额外安装 CLI。
- 不同 CLI 版本产生兼容问题。
- 登录、权限和沙箱状态不可控。
- Windows、macOS 和 Linux shell 差异。
- Agent 修改不应修改的文件。
- 任务恢复和结果格式难以保证。
- 增加常驻进程和机器资源消耗。

结论是：不接 Agent CLI 不会限制本项目使用大模型，只会要求应用自行实现少量、受控的工具编排；换来的则是更稳定、更安全、更轻量的 PPT 生产流程。

## 17. 许可证注意事项

Open Design 根项目采用 Apache-2.0 许可证，但其模板目录包含多个第三方来源、字体、素材和各自的授权或 attribution 要求。

如果未来需要复制具体代码或模板，应：

1. 检查对应文件和目录的许可证。
2. 保留原有版权和 attribution 信息。
3. 对修改过的文件标明修改。
4. 不根据根目录许可证推断所有第三方模板都可无条件复制。

在没有确认授权前，优先借鉴架构和实现思路，在本项目目录中重新实现。

## 18. 当前结论

本项目应借鉴 Open Design 的：

- daemon 思路。
- SQLite 与资产文件分层。
- 异步任务状态。
- 媒体 API 安全和重试策略。
- Electron 安全边界。
- 大文件路径传递。
- PptxGenJS 页面比例与背景图导出。
- 内容策划、页面角色和视觉节奏方法。

本项目不应继承 Open Design 的：

- 将通用 Agent CLI 作为核心运行时的架构。
- 插件和 MCP 体系。
- 多设计产物工作区。
- HTML Deck 核心模型。
- 通用 `dom-to-pptx` 工作流。
- 复杂 Web、sidecar、部署和发布体系。

本项目的大模型接入原则是：

- 核心能力直接调用文本、视觉、图片生成和图片编辑 API。
- 使用应用自有的结构化 prompt 和受控工具循环。
- 只向模型开放 PPT 领域白名单工具。
- Agent CLI 作为后期可选高级能力，不作为核心流程依赖。
- 内容规格中的预定文案是最终文字权威来源，OCR 主要负责位置和样式参考。

真正需要优先自主验证和建设的是：

```text
页面内容规格
  → 逐页图片生成
  → OCR / Layout Recognition
  → Masked Clean Plate Generation
  → Text Layer Reconstruction
  → PPTX Composition
  → Visual Validation
```
