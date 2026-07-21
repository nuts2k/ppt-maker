# M1 单页图片转可编辑 PPTX 原型设计

## 1. 设计目标

M1 建立一条可观察、可人工复核、可增量重跑的单页流水线：

```text
16:9 源图
  → 离线 OCR
  → 结构化候选合并
  → AI 辅助纠错与分类（GPT-5.6-Luna）
  → 残留不确定项人工处理
  → 系统自动字形 mask
  → GPT Image 2 clean plate
  → clean plate 人工接受
  → 微软雅黑原生文本框 PPTX
  → PowerPoint 人工接受
  → 分阶段报告
```

系统不以“自动调用成功”替代质量通过。目标文字最终 100% 进入原生文本层依赖明确的人工复核闭环，但人工不得直接替换 mask、clean plate 或 PPTX 内的流水线产物来绕过可追踪阶段。

## 2. 范围与现有基础

复用 M0：

- `packages/core` 的 16:9 校验、坐标换算、基础 Schema 和错误类型。
- `apps/cli` 的命令入口、环境诊断、图片读取、Vision OCR 和 PptxGenJS 探针。
- `native/macos-vision-ocr` 的 Apple Vision 离线进程边界。
- Node.js 24、pnpm 10、TypeScript strict/ESM、Biome 和 Vitest。

M1 仍不引入 Electron、React、SQLite、多页调度或 `open-design/` 代码依赖。

## 3. 目录和模块边界

新增代码优先放入现有包，不提前拆空包：

```text
packages/core/src/
  workspace-contracts.ts    # M1 工作区、阶段、复核、Provider 契约
  stage-graph.ts            # 阶段依赖、输入哈希和失效规则
  text-blocks.ts            # 候选合并、复核校验和坐标/四边形规则
  mask-contracts.ts         # 自动 mask 参数和完整性记录

apps/cli/src/
  slide/                    # M1 slide 子命令与文件编排
  providers/openai-vision.ts
  providers/openai-image.ts
  mask/                     # 本地像素分割和派生预览
  pptx/                     # 正式单页合成
  report/                   # 验证报告

native/macos-vision-ocr/
  # 扩展字符/子串四边形输出，仍不泄漏 Vision 类型

fixtures/single-slide/
  # 可公开提交的合成复杂页面和基准结构化文件
```

真实用户页面位于本地工作区；未确认可公开前不提交 Git。

## 4. CLI 契约

命令采用显式阶段，不提供不可观察的一体化长命令：

```text
ppt-maker slide init <image> --workspace <dir> [--reference <file>]
ppt-maker slide ocr <workspace>
ppt-maker slide review <workspace>
ppt-maker slide assist-review <workspace> --confirm-api
ppt-maker slide validate-review <workspace>
ppt-maker slide mask <workspace>
ppt-maker slide clean <workspace> --confirm-upload
ppt-maker slide accept-clean <workspace> [--note <text>]
ppt-maker slide pptx <workspace>
ppt-maker slide accept-pptx <workspace> [--note <text>]
ppt-maker slide report <workspace>
ppt-maker slide run <workspace> --from <stage>
```

约束：

- `assist-review` 和 `clean` 必须带显式确认（`--confirm-api` / `--confirm-upload`）；不得由低置信度或 `run` 静默触发。
- `run --from` 顺序执行本地阶段，在外部调用或人工质量门前停止并报告下一条明确命令。
- 每个命令先验证工作区 Schema、阶段依赖和输入哈希。
- 所有写入采用临时文件 + 原子替换；失败不得覆盖上一次有效产物。

## 5. 页面工作区

建议布局：

```text
<workspace>/
  manifest.json
  config.json
  inputs/
    source.<png|jpg>
    reference.txt           # 可选
  stages/
    ocr/result.json
    review/text-blocks.json # 候选合并 + AI 辅助后的主文件
    assist-review/result.json
    mask/mask.png
    mask/preview.png
    mask/overlay.png
    mask/record.json
    clean/attempt-001.png
    clean/attempt-001.json
    clean/accepted.json
    pptx/slide.pptx
    pptx/record.json
    pptx/accepted.json
    report/report.json
```

manifest 记录相对路径，禁止把绝对路径写成跨机器契约。每项资产保存 SHA-256、字节数、尺寸、创建时间和产生它的阶段尝试 ID。

## 6. 阶段图与失效

```text
init ─→ ocr ─→ review ─→ assist-review ─→ validate-review ─→ mask ─→ clean ─→ accept-clean ─→ pptx ─→ accept-pptx ─→ report
```

- `review` 合并 OCR 候选和可选原始文案，生成 text-blocks.json（全部 unreviewed）。
- `assist-review` 读取 text-blocks.json，将文本发送到 GPT-5.6-Luna 做纠错和分类；明确分类的块自动标记 reviewed + includeInMask，uncertain/risk 块保持 unreviewed。
- 人工确认值独立保存，不被 AI 辅助静默覆盖。
- 修改 reference 使 review 及下游失效，不使 OCR 失效。
- 修改已复核文字内容/样式只使 PPTX、accept-pptx、report 失效；若修改 bbox、四边形、旋转、分类、mask 参与或 mask 参数，则 mask 及全部下游失效。
- 修改 mask 算法版本使 mask 及下游失效。
- clean prompt、模型、尺寸或质量变化使 clean 及下游失效。
- 任一上游哈希变化自动撤销对应人工接受记录。

## 7. 数据契约

### 7.1 坐标

- 源图左上角为原点，单位为像素，是人工复核权威坐标。
- `bboxPx` 用于编辑和 PPTX 文本框；`quadPx` 表达旋转区域，四点顺序固定为左上、右上、右下、左下。
- OCR 可以输出字符或子串 `glyphHints` 四边形，但它们只是定位提示，不是字形 mask。
- clean plate 固定输出 `2048x1152`；背景铺满 wide 页面。文字框继续从源图权威坐标线性换算，不从 clean plate 重新 OCR。

### 7.2 TextBlockReview

每个块至少包含：

- `id`、`text`、`lines`、`bboxPx`、`quadPx`、`rotationDeg`、`zIndex`。
- `classification`：`layout_text`、`object_integrated_symbol`、`uncertain`。
- `sources`：offline OCR、cloud vision、reference、manual，保存候选文本和置信度。
- `includeInMask`、`reviewStatus`、`riskAcceptance`。
- 文本样式：字号、字重、颜色、水平/垂直对齐、行距；字体固定为 `Microsoft YaHei`，文件中不允许覆盖。
- 自动 mask 参数：前景颜色候选、颜色容差、边缘阈值、连通域面积、膨胀半径、排除多边形。
- 修改元数据和上次复核时间。

人工编辑 JSON 后必须运行 `validate-review`。`uncertain` 不得 `includeInMask: true`；目标文字在导出前必须 reviewed 或逐项显式接受风险。

### 7.3 Provider 记录

所有外部请求保存：

- Provider、endpoint、模型、模型参数和提示词版本。
- 发送资产的相对路径和哈希。
- 请求 ID、开始/结束时间、耗时、用量、错误和响应哈希。
- 响应原文与经 Schema 解析后的结果分开保存。
- API Key 只从 `OPENAI_API_KEY` 读取，禁止写入工作区、日志或错误 details。

## 8. 离线 OCR 与云端视觉分析

### 8.1 Apple Vision

- 继续使用 `.accurate`、简体中文和英文识别。
- 扩展输出 top candidate 的字符/子串四边形，用于旋转估计和局部分割范围。
- Vision 官方说明字符框仅适合 UI，不适合直接图像处理；核心契约名称使用 `glyphHints`，防止误当精确笔画。

### 8.2 AI 辅助复核（GPT-5.6-Luna）

固定配置：

```text
API: Responses API
model: gpt-5.6-luna
input: 纯文本（OCR 文本 + bbox 空间上下文，不上传图片）
output: Structured Outputs
```

输入为 text-blocks.json 中所有块的 text、bboxPx 和 OCR confidence。输出为每个块的纠错文本、classification 和 risk 标记。

自动复核规则：
- AI 分类为 `layout_text` → `reviewStatus: "reviewed"`, `includeInMask: true`
- AI 分类为 `object_integrated_symbol` → `reviewStatus: "reviewed"`, `includeInMask: false`
- AI 分类为 `uncertain` 或带 risk → `reviewStatus: "unreviewed"`, `includeInMask: false`
- AI 纠错后的文本作为新 source（`kind: "ai_text_assist"`）写入，纠错文本替换 block.text
- 已被人工编辑的块（`isHumanTouched`）不被 AI 覆盖

## 9. 自动 Mask

mask 是系统派生产物，禁止人工编辑或替换。

`glyphHints` 由 mask 阶段直接从 OCR 阶段产物读取（按 bbox 重叠匹配到复核块），复核文件（§7.2）不携带逐字符 quad——逐字符 quad 是机器先验，不进入人工编辑面。OCR 产物哈希纳入 mask 输入指纹，OCR 重跑使 hints 变化并让 mask 及下游失效。`glyphHints` 只作软先验（外扩容错后收窄搜索范围），为空或缺失时降级到 `quadPx`/bbox，永不作为精确字形轮廓直接输出。

候选算法：

1. 使用复核后的 `quadPx` 和从 OCR 产物读取的 Vision `glyphHints` 限制局部搜索范围。
2. 根据源图像素、云端颜色候选和结构化参数计算颜色/亮度距离与边缘响应。
3. 生成连通域，剔除越出允许区域、面积异常或落入排除多边形的区域。
4. 对描边、阴影和抗锯齿边缘执行受控膨胀，合并所有 `includeInMask` 文字块。
5. 输出与源图同格式、同尺寸、带 alpha 的 API mask，以及黑白预览和叠加预览。
6. 保存源图、review、算法版本、参数和输出哈希。

`clean` 阶段重新计算并校验 mask 哈希；外部涂改或替换必须失败。复杂样例质量通过修改结构化区域/参数并重跑实现，不开放 bitmap 编辑入口。

## 10. GPT Image 2 Clean Plate

固定配置：

```text
API: POST /v1/images/edits
model: gpt-image-2
size: 2048x1152
quality: high
output_format: png
```

提交源图、自动 mask 和版本化提示词。提示词以用户确认的两段规则为核心：只移除独立版式文字字形，保留容器和全部对象内符号，不简化图标或改变布局。

官方明确 mask 只是引导而非逐像素硬约束，因此每次尝试都必须保存并单独检查：

- 目标文字残留。
- 容器完整性。
- mask 外非文字误改。
- 输出尺寸和比例。

失败只允许修正上游结构化数据、mask 算法参数、提示词版本或固定 API 契约允许的实现错误后重试。不允许导入人工 clean plate，也不允许绕过人工接受门。

## 11. PPTX 合成

- 只使用已接受 clean plate 作为全页背景。
- 只为 `layout_text` 且已复核/显式接受风险的块生成文本框。
- 字体固定 `Microsoft YaHei`；缺失时阻止导出。
- 使用复核后的 bbox、旋转、字号、字重、颜色、对齐、行距、换行和 zIndex。
- 艺术字只保证内容、位置和旋转可编辑；复杂特效不自动复刻。
- 自动检查 PPTX ZIP/XML 结构、页面比例、文本内容、字体声明和形状数量；PowerPoint 人工接受是最终门。

## 12. 人工质量门

`accepted.json` 至少包含：

- `artifactPath`、`artifactSha256`、`acceptedAt`、`acceptedBy`、`note`。
- clean plate 接受前必须存在最新预览和检查清单。
- PPTX 接受前必须确认 PowerPoint for Mac 可打开、文本可编辑、字体正确、页面比例正确。
- 上游哈希变化时接受文件不删除，但状态变为 stale，便于审计且不能放行。

## 13. 测试与验证

- 单元：阶段图、哈希失效、Schema、候选合并、坐标/四边形、mask 参数和接受门。
- fixture：合成复杂页覆盖中文、英文/混排、容器、对象内符号、旋转/艺术字。
- Provider 契约：使用 fake client 测试请求、Structured Outputs、错误、用量和敏感信息不落盘。
- 自动 mask：使用基准图和像素级预期统计测试尺寸、alpha、覆盖范围、完整性拒绝。
- GPT Image 2：真实 API 测试为显式、可计费、非默认测试；保存调用证据和结果，不在无 Key 环境伪造通过。
- PowerPoint：保存人工检查记录，Quick Look 不作为字体权威证据。
- 最终全量运行 Node 24、format、typecheck、test、build、Trellis validate 和 `git diff --check`。

## 14. 安全、成本与隐私

- OCR 默认离线；`assist-review --confirm-api` 发送纯文本到 API（不上传图片）；`clean --confirm-upload` 上传图片。
- 命令执行前打印将发送的文件、哈希、模型和用途。
- 不输出或持久化 API Key。
- 每次调用记录用量，但 M1 不设成本硬门槛。
- 用户真实页面默认不提交 Git；报告可只保存哈希和本地相对路径。

## 15. 回滚与停止条件

- AI 辅助复核结构化输出不稳定：保留离线 OCR 和人工 review，修正提示词/Schema，不允许静默解析自由文本。
- 自动 mask 无法在真实样例保持容器：停止 clean plate 扩展，优先改进局部分割和结构化参数，不用人工 bitmap 绕过。
- GPT Image 2 多次破坏容器或对象细节：保存失败尝试并形成 M1 不可行证据；不切换 Provider、不导入人工 clean plate、不宣称完成。
- PptxGenJS 排版不足：保留已确认的文字/clean plate 契约，调整合成层，不回退为位图文字。
