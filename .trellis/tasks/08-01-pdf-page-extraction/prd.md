# 子任务② PDF 抽取（`extracted` 来源）

父任务：`07-31-page-sources-and-content-generation`（M5）。
把 PDF 逐页转位图并建立 slide 工作区，使 `extracted` 页与 `imported` / `generated` 页
在同一 deck 内平等共存。

## 目标

承父任务 R4：PDF 逐页渲染为 16:9 位图并建立 slide workspace，
按 D1 探测记录每页是否含可提取文本层，按 D2 逐页判定 16:9。

## 父任务已定、②不得改动的

| ID | 结论 |
|---|---|
| D1 | **矢量 PDF 一律位图化**，但探测并记录每页是否含可提取文本层，界面显式提示。直取文本路径不在 M5 |
| D2 | **16:9 维持拒绝，尺寸假设全链路不动**；抽取改为**逐页判定**，不合格页带尺寸与原因进入报告并跳过，**不让单页异常挂掉整份导入**。整份为空才失败 |
| — | 来源契约由父任务独占。②若发现契约需改动，回父任务改，不在实现里微调 |

## 背景：已确认事实

### `ExtractedSource` 契约已完整落地（①做的）

`packages/core/src/source-contracts.ts:28`，字段已冻结，②只负责填充：

```
documentName / documentSha256 / pageNumber(1-based) / hasExtractableText
rendererId / rendererVersion / renderDpi / recordedAt / attemptId
```

`documentSha256` 支撑「同一份文档重抽时可比对」；`rendererId` + `rendererVersion`
保证同一页可复现——**这两个字段的存在本身就要求渲染器有稳定的版本标识**。

### ① 已铺好的地基（直接复用）

| 能力 | 位置 |
|---|---|
| `createSlideWorkspace` 接受 `options.source` | `slide/workspace.ts:225` |
| `requiresSourceAcceptance` 对 `extracted` 返回 false（自动放行，且不伪造人工验收记录） | `source-contracts.ts:89` |
| 源图资产尺寸已用 sharp 实测填充 | `slide/workspace.ts:264` |
| 16:9 硬断言与 0.5% 容差 | `geometry.ts:74`、`constants.ts:4` |
| `addSlideToDeck` 只追加到末尾，`page-NN` 目录名分配后不重排 | `deck/add-slide.ts:43` |

### 仓库现状：没有任何 PDF 处理能力

`apps/cli` 依赖只有 `commander / dotenv / image-size / jszip / openai / pptxgenjs / sharp`。

### 既有的原生二进制先例（本任务照它扩展）

`native/macos-vision-ocr/`：单文件 Swift（`Sources/main.swift`），`xcrun swiftc` 直接编译
（`pnpm build:vision`，无 SwiftPM），CLI 侧经 `execFile` 调用、读 stdout JSON、zod 校验
（`apps/cli/src/ocr.ts:14`），二进制缺失时给「请先运行 pnpm build:vision」的友好报错。

### 混合来源 deck 靠「按页序依次操作」实现

父任务 A2 要求交错混合（1/3 页导入、2 页 PDF、4–6 页生成）。
`addSlideToDeck` 只能追加末尾且不重排，因此实现方式是**按页序依次调用不同来源的命令**，
不需要「插入到第 N 页」的能力。

→ 由此得出跨②③ 的硬要求：**两者都必须支持往已有 deck 追加**，不能只支持新建 deck。

## 已定决策

| ID | 决策 | 结论 | 理由 |
|---|---|---|---|
| F1 | PDF 渲染路径 | **Swift + PDFKit 原生二进制**，新增 `native/macos-pdf-render/`，与 Vision OCR 同构 | PDFKit **一次调用同时覆盖 D1 与 D2 的全部需要**：渲染位图、`page.string` 探测文本层、页尺寸，三件事一个 API 拿全，其它方案要拼装两三个库。零新增 npm 依赖。macOS-only 不是本任务新增的约束——Apple Vision OCR 已把整条链路锁死在 macOS，ROADMAP 也明确 Windows 正式支持单独立项 |
| F2 | 建新 deck 与追加的命令形态 | **单命令，deck 不存在则创建**：`deck extract --pdf <file> --deck <path>`，与③ 的 `deck generate` 同构 | 来源是「维度」而非「链路」（父任务核心思想），建 vs 追加不该按来源分裂成两套命令 |
| F3 | 渲染尺寸 | **固定目标宽度 2048px**（16:9 页即 2048×1152），`renderDpi` 记录反推值 | 按固定 DPI 渲染会让混合了不同页面尺寸的 PDF 产出像素数差一截的图；固定宽度让每页分辨率可预期，且与 clean plate 的 2048 档位对齐。PDF 是矢量，小尺寸页放大到 2048 宽不失真。`renderDpi` 记反推值，字段语义（这页实际按多少 DPI 渲染）依然成立 |
| F4 | A5 / A6 走查素材 | **A5 用你从 `~/test/b2-export-strict.pptx` 导出的 PDF**（真实矢量文本层）；**A6 的混合宽高比 PDF 由 Swift 合成** | b2 那份是项目自己产出的原生可编辑 PPTX，导出即天然「16:9 + 含矢量文本层」，正好打中 A5；混合宽高比是人为构造的边界，合成件足够且更可控。导出需人操作——本机无屏幕录制与辅助访问权限 |

### 技术判断（有充分依据，非用户决策）

1. **16:9 判定用 PDF 页的原始尺寸（渲染前）**，不是渲染后的像素。
   渲染完再拒绝白费一次渲染，且渲染后的像素尺寸由 F3 的固定宽度决定，
   反而丢失了页面真实比例信息。
2. **`pageNumber` 记 PDF 原始页号**。10 页 PDF 跳过第 3、7 页后建出 8 页，
   `page-03` 的 `pageNumber` 是 4——溯源指向原文档，不是 deck 内序号。这是刻意的。
3. **跳过页的报告落 deck 级文件**：`<deck>/extractions/<时间戳>-<docSha 前 8>.json`，
   每次抽取一份、不覆盖。
   - 不塞进 `DeckManifest`：会让它同时承担第二种职责，且规格/报告文件缺失时
     manifest 会变成指向不存在文件的悬空引用（与③ 拒绝把 content-spec 塞进 manifest 同理）。
   - 不只打印：A5 要求「落盘且在界面可见」，子任务④ 要在桌面端显示。
   - 不覆盖：与仓库「多次尝试序号递增不覆盖」的一贯做法一致；同一 PDF 换 `--pages` 重抽结果不同。
4. **`rendererId = "macos-pdfkit"`**，`rendererVersion` = 二进制自身版本常量 + 运行时 macOS 版本
   （`ProcessInfo.operatingSystemVersion`）。PDFKit 无独立版本号，宿主系统版本是唯一可复现锚点。
5. **`--pages <范围>` 选项**（如 `3-8,12`），默认全部。成本极低，且抽取是有成本的操作。

## 需求

- **R1 PDF 原生二进制**：`native/macos-pdf-render/Sources/main.swift`，
  输入 PDF 路径与目标宽度，逐页输出 PNG 与元数据 JSON（页号、原始尺寸、
  是否含可提取文本、实际渲染像素、反推 DPI）。`pnpm build:pdf` 编译。
- **R2 文本层探测**：每页 `PDFPage.string` 非空即 `hasExtractableText = true`（D1）。
- **R3 逐页 16:9 判定**：按原始页尺寸判定，不合格页跳过并记录尺寸与原因（D2）；
  整份为空才失败，退出码在「至少建立一页」时不视为失败。
- **R4 建页与追加**：合格页经 `createSlideWorkspace` 建立 slide 工作区并填 `ExtractedSource`；
  deck 不存在则创建，存在则按页序追加（F2）。
- **R5 抽取报告落盘**：deck 级报告文件记录该次抽取的全部页——建立的与跳过的、
  各自的原始尺寸、文本层探测结果、跳过原因（技术判断 3）。
- **R6 CLI 入口**：`deck extract --pdf <file> --deck <path> [--pages <范围>]`。

## 验收标准

> 覆盖形状照 `.trellis/spec/guides/verification-coverage-thinking-guide.md` 检查。

- [ ] **P1 逐页建立**：N 页全 16:9 的 PDF 抽取后建出 N 页，每页
      `source.kind === "extracted"`，`documentSha256` / `pageNumber` / `renderDpi` 等字段齐备。
- [ ] **P2 尺寸实测**：抽取页的 `source_image` 资产 `image.width/height` 与磁盘 PNG 实际像素
      **逐字节一致**（沿用③ 的同一约束：不接受「等于请求的目标宽度」）。
- [ ] **P3 文本层探测（父任务 A5）**：含矢量文本层的 PDF 抽取后，
      每页 `hasExtractableText` 落盘且值正确。**须用 F4 的真实导出 PDF 验。**
- [ ] **P4 逐页判定与跳过（父任务 A6）**：混合宽高比的 PDF 抽取后，16:9 页正常建立、
      非 16:9 页带**尺寸与原因**进入报告并跳过，**命令不整体失败**（退出码 0）。
- [ ] **P5 整份为空才失败**：一份全是非 16:9 页的 PDF 抽取后命令失败（非零退出码），
      且不留下半成品 deck。
- [ ] **P6 页号溯源**：跳过中间页后，建出页的 `pageNumber` 指向 PDF 原始页号而非 deck 内序号。
- [ ] **P7 抽取的页能跑完下游**（覆盖形状，不可简化）：取一个抽取出的页，
      **继续跑 `ocr` → `review` → `mask` → `pptx` 成功**。
      只验到「抽取成功」等于只证明了「没有立刻炸」。
- [ ] **P8 追加到已有 deck**：向一个已有页的 deck 抽取追加，新页接在末尾，
      **既有页的阶段状态与已确认产物完全不受影响**，`page-NN` 目录名不重排。
- [ ] **P9 自动放行不伪造人工痕迹**：抽取页的 `accept-source` 为 `completed`，
      但磁盘上**没有** `stages/source/accepted.json`（父任务 A10 的口径，判据就是文件在不在）。
- [ ] **P10 换源互通**：把一个抽取页换源为导入图，来源正确翻转为 `imported`
      且不再需要人工确认；反向亦然（父任务 A11 的 `extracted` 侧）。
- [ ] **P11 报告可读**：抽取报告落盘且含建立页与跳过页两部分，跳过项有尺寸与原因。
- [ ] **P12 既有工作区零影响**：M3/M4 时代的旧 deck 在本任务改动后仍可打开、继续处理、
      `--strict` 导出。**须在真实历史 deck 上验**（`~/test/ppttest-2026-07-25` 的副本）。

## 不做

- **矢量 PDF 直取文本**：D1 明确不在 M5。本任务只探测并记录，不消费。
- **放宽 16:9 / 裁剪 / 补边**：D2 明确。
- **PDF 以外的文档格式**（PPTX / Keynote / 图片 PDF 混排以外的输入）：
  父任务范围只有 PDF，ROADMAP 把「多种设计产物平台」列为非目标。
- **桌面端入口与报告呈现**：归子任务④。本任务只保证数据落盘可读。
- **加密 PDF 的密码输入**：遇加密文档直接以 `FoundationError` 报错退出，不做交互解锁。
