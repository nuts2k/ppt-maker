# 子任务② 技术设计

父任务契约（`07-31-.../design.md` §2 §7）为唯一上位来源。本文只定②自己的部分。

## 1. 边界

| ② 拥有 | ② 不碰 |
|---|---|
| PDF 渲染二进制与其 JSON 契约 | `SlideSource` / `ExtractedSource` 形状（① 已冻结） |
| 逐页判定与跳过的编排、抽取报告 | 16:9 判定的容差与几何（core 已有，直接复用） |
| `deck extract` 命令 | 阶段图（父任务 §5：② 不得新增阶段） |
| 报告的落盘形状 | 桌面端呈现（归子任务④） |

## 2. Swift 二进制：`native/macos-pdf-render`

照 `native/macos-vision-ocr` 扩展：单文件 Swift、`xcrun swiftc` 编译、
stdout 输出 JSON、CLI 侧 zod 校验、二进制缺失给友好报错。

### 2.1 两个子命令，而非一次调用

```
macos-pdf-render probe  <pdf>                       → 全部页的元数据，不渲染
macos-pdf-render render <pdf> <输出目录> <目标宽度> --pages 1,2,5  → 只渲染指定页
```

**为什么分两次**：16:9 判定必须留在 TS 侧，用 core 既有的容差与几何
（`geometry.ts:74`、`constants.ts:4` 的 0.005）。若让 Swift 自己判定，
判定逻辑就分裂成 TS 与 Swift 两份，容差改一处忘一处——这正是父任务
`requiresSourceAcceptance` 立「单点定义」时防的那类问题。

分两次的代价是两次进程启动；`probe` 只读页尺寸与文本层、不做渲染，很快。
收益是**不渲染注定要跳过的页**，且 Swift 侧保持零业务逻辑。

### 2.2 `probe` 输出

```
{
  rendererId: "macos-pdfkit",
  rendererVersion: "<二进制版本常量>+macOS-<ProcessInfo 版本>",
  documentPageCount: int,
  encrypted: boolean,
  pages: [{ pageNumber: int(1-based), widthPt: number, heightPt: number,
            hasExtractableText: boolean }]
}
```

- `hasExtractableText`：`PDFPage.string` 去空白后非空即 true（D1）。
- `widthPt` / `heightPt`：取 `PDFPage.bounds(for: .mediaBox)`，用于 TS 侧判定 16:9。
- `encrypted` 为 true 时 CLI 侧直接以 `FoundationError` 退出，不做交互解锁。

### 2.3 `render` 输出

```
{ pages: [{ pageNumber, path, width, height, renderDpi }] }
```

`renderDpi = 目标宽度 / (widthPt / 72)`，即反推值（F3）。
渲染用 `PDFPage.draw(with:to:)` 至 `CGContext`，PNG 落盘。

**CLI 侧不信任这里的 `width/height`**：源图资产尺寸由 `createSlideWorkspace`
内的 sharp 实测填充（`slide/workspace.ts:264`）。这与③ 的 RK1 衍生约束同源——
渲染器报的尺寸与磁盘文件不符时，实测才是真的。

## 3. 抽取流程

```
probe → TS 侧逐页判定 16:9（core 容差）
      → 合格页列表交给 render
      → 逐页 createSlideWorkspace({imagePath, source: extracted draft})
      → deck 不存在则先 createDeckWorkspace 的等价初始化，存在则追加
      → 写抽取报告（建立的 + 跳过的 + 原因）
      → 汇总输出；至少建立一页即退出码 0
```

- **判定用原始页尺寸**（`widthPt/heightPt` 之比），不是渲染后的像素——
  渲染后的宽度被 F3 固定为 2048，比例信息已丢失。
- **跳过不中断**：单页跳过或渲染失败都记录原因继续，与父任务 §7 对 D2 的口径一致。
- **整份为空才失败**，且不留下半成品 deck（新建路径下，一页都没建成就把临时目录清掉，
  沿用 `createDeckWorkspace` 已有的 mkdtemp + rename 原子模式）。

## 4. 追加语义（F2）

`deck extract --deck <path>`：

- 目录不存在 → 建新 deck（等价 `deck init` 的初始化 + 逐页追加）。
- 目录存在且是合法 deck → 按 `addSlideToDeck` 的同一规则追加到末尾，
  `page-NN` 由 `nextPageNumber` 分配、**既有页目录名不重排**（`deck/add-slide.ts:23`）。

追加时**既有页零改动**是硬要求（P8）：只往 `manifest.slides` 末尾 push，不动其它条目。

## 5. 抽取报告

`<deck>/extractions/<ISO 时间戳>-<docSha 前 8>.json`，每次抽取一份、不覆盖。

```
{
  schemaVersion: 1,
  documentName, documentSha256, extractedAt,
  renderer: { id, version },
  requestedPages: string | null,      // --pages 原样，null 表示全部
  created: [{ pageNumber, workspacePath, widthPt, heightPt, renderDpi, hasExtractableText }],
  skipped: [{ pageNumber, widthPt, heightPt, hasExtractableText, reason }]
}
```

`reason` 用结构化枚举（`aspect_ratio_mismatch` / `render_failed` / `out_of_range`）
加人类可读消息，供子任务④ 在桌面端呈现时不必解析自由文本。

**不进 `DeckManifest`**：会让它同时承担第二种职责，且报告文件缺失时 manifest 会变成
指向不存在文件的悬空引用。约定目录没有这个问题——`readdir` 一次即知。

## 6. 兼容

- **零新增 npm 依赖**，零 schema 版本变更，不新增阶段、不扩任何闭合枚举。
  `ExtractedSource` 与 `role` 枚举都已由① 落地。
- ② 是本轮唯一**不改 core 契约**的子任务，因此对既有工作区的风险最低；
  P12 仍须在真实历史 deck 上验（改动虽小，`deck` 层代码有共用路径）。

## 7. 权衡与回滚点

- **F1 的 macOS 绑定**是本任务最大的不可逆决定。回滚代价：若将来要 Windows，
  这个二进制要整份重写。接受它的依据是 Apple Vision OCR 已经锁死了平台，
  ② 不引入**新的**平台约束。
- **PDFKit 渲染保真度**未经实证。若某类 PDF（含透明度、特殊字体、CMYK）渲染异常，
  回滚点是换 `pdftoppm` 作渲染后端——`probe` / `render` 的 JSON 契约不变，
  只换二进制实现，TS 侧零改动。这是把契约切在二进制边界上的收益。
- **不做的**：直取文本、放宽 16:9、PDF 以外格式、桌面端呈现、加密 PDF 交互解锁
  （见 `prd.md`〈不做〉）。
