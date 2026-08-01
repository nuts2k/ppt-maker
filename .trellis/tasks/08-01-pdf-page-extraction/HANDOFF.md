# 会话交接：子任务② 规划完成，待实现

写于 2026-08-01 规划会话结束时。规划产物已提交到 `main`，**未 push**。

## 立刻做这两步

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-01-pdf-page-extraction
pnpm --filter @ppt-maker/core build     # dist 不入库，typecheck 前必须先 build
```

**不要重新规划**。`prd.md` / `design.md` / `implement.md` 三份齐备，四个决策已定稿，
两份 jsonl 已按真实 spec 清单填好。直接从 `implement.md` 阶段一开始。

## 需要用户先做一件事（阻塞 P3，不阻塞开工）

**用 PowerPoint for Mac 把 `~/test/b2-export-strict.pptx` 导出成 PDF，放到 `~/test/`。**
它是项目自己产出的 2 页原生可编辑 PPTX，导出即天然「16:9 + 含真实矢量文本层」，
正好打中 P3（父任务 A5）。合成 PDF 带着我们自己的假设，`hasExtractableText`
在真实导出件上才有意义。

本机无屏幕录制与辅助访问权限，AI 点不了 PowerPoint。
A6 的混合宽高比 PDF 由实现会话用 Swift 合成，不需要人工。

## 当前状态

| 项 | 状态 |
|---|---|
| 父任务 M5 | `in_progress`，阶段一完成，阶段二进行中 |
| 子任务① 页面来源契约与换源 | 已完成并归档 |
| 子任务② PDF 抽取（本任务） | **规划完成，未开始实现** |
| 子任务③ 图片生成 | **规划完成，未开始实现**（`.trellis/tasks/08-01-spec-driven-generation/`） |
| 子任务④ 桌面端入口收口 | 尚未创建，依赖②③ |

②③ 互不依赖，可并行实现。

## 四个决策

- **F1** PDF 渲染走 **Swift + PDFKit 原生二进制**（新增 `native/macos-pdf-render/`）。
- **F2** **单命令，deck 不存在则创建**：`deck extract --pdf <file> --deck <path>`。
- **F3** 渲染尺寸**固定宽 2048px**，`renderDpi` 记反推值。
- **F4** P3 用真实导出 PDF、P4 的混合宽高比 PDF 用 Swift 合成。

理由见 `prd.md`〈已定决策〉表，不再复述。

## 动手前必读

1. `.trellis/spec/guides/verification-coverage-thinking-guide.md`
2. `.trellis/spec/backend/contracts.md`（阶段落库契约、自动放行不伪造人工痕迹）

## 五个必须带进实现会话的判断

**1. 16:9 判定必须留在 TS 侧，用 core 既有容差。** 不要图省事让 Swift 自己判——
判定逻辑一旦分裂成 TS 与 Swift 两份，容差就会改一处忘一处。这正是①立
`requiresSourceAcceptance` 单点定义时防的那类问题。二进制因此分 `probe` / `render`
两个子命令：`probe` 只读页尺寸与文本层不渲染，TS 判完再让它渲染合格页。

**2. 判定用 PDF 页原始尺寸（`widthPt/heightPt`），不是渲染后的像素。**
渲染后的宽度被 F3 固定成 2048，比例信息已经丢了。

**3. 源图资产尺寸仍以 sharp 实测为准**，不用 Swift 报的 `width/height`。
与③ 的 RK1 衍生约束同源：渲染器报的尺寸与磁盘文件不符时，实测才是真的。
P2 的用例要显式断言「资产尺寸 == 磁盘 PNG 实际像素」，不接受「== 目标宽度 2048」。

**4. `pageNumber` 记 PDF 原始页号。** 10 页 PDF 跳过第 3、7 页后建出 8 页，
`page-03` 的 `pageNumber` 是 4——溯源指向原文档而非 deck 内序号，这是刻意的。

**5. 追加时既有页零改动。** `addSlideToDeck` 只往 `manifest.slides` 末尾 push，
`page-NN` 由 `nextPageNumber` 分配、**不重排**。父任务 A2 的交错混合 deck
就是靠按页序依次调用不同来源的命令实现的。

## 验收形状不可简化的三条

- **P7**：抽取出的页要**继续跑 ocr → review → mask → pptx 成功**。
  只验到「抽取成功」等于只证明了「没有立刻炸」。
- **P3**：必须用真实导出 PDF 验，合成件的结论不算。
- **P12**：兼容性必须在 `~/test/ppttest-2026-07-25` 的**副本**上验，不接受 fixture 推断。

## 回滚点

**PDFKit 渲染保真度未经实证。** 若某类 PDF（透明度 / 特殊字体 / CMYK）渲染异常，
回滚点是换 `pdftoppm` 作后端——`probe` / `render` 的 JSON 契约不变、TS 侧零改动。
这是把契约切在二进制边界上的收益，**发现问题时不要改 TS 侧去将就**。

## 走查环境

- **`~/test/ppttest-2026-07-25` 是基线**：M3/M4 旧格式，P12 一律从它**复制**后验。
- `pnpm build:pdf` 是本任务新增的构建脚本；`pnpm typecheck` 前先 build core。
- 本仓库**没有 lint 脚本**，风格检查是 `pnpm format:check`（只覆盖 `apps/*/src`、
  `packages/*/src`，**Swift 代码不在覆盖范围内**）。

## 与子任务③ 的一个共享约定

②的 F2（单命令、deck 不存在则创建）在规划时回写进了③——③ 原本只设计了「建新 deck」，
那会让父任务 A2 的混合来源走查无法实现。③ 的 `deck generate` 已同步改为同一形态，
并新增 C14 验收「往混合 deck 追加生成页时，对账不把 imported/extracted 页报成失联」。
**两个子任务的这条命令语义必须保持一致**，一方改动要通知另一方。
