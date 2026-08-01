# 子任务② 执行计划

顺序按依赖排。②不改 core 契约，风险显著低于①③。

## 阶段一：Swift 渲染二进制

- [x] 1.1 新建 `native/macos-pdf-render/Sources/main.swift`，照
      `native/macos-vision-ocr/Sources/main.swift` 的结构（单文件、argv 入参、stdout JSON）。
- [x] 1.2 实现 `probe` 子命令（design §2.2）：页数、每页 `widthPt/heightPt`
      （`PDFPage.bounds(for: .mediaBox)`）、`hasExtractableText`（`PDFPage.string` 去空白非空）、
      `encrypted`、`rendererVersion`（版本常量 + `ProcessInfo.operatingSystemVersion`）。
      实现偏差：几何取 `CGPDFPage.getBoxRect(.mediaBox)` + `rotationAngle` 而非 `PDFPage.bounds`
      ——后者是否把 `/Rotate` 算进去在文档上不明确，CGPDFPage 两个值无歧义；`encrypted`
      的判据是 `isLocked` 而非 `isEncrypted`（只设权限口令的 PDF 能正常渲染，拒绝它是错的）。
- [x] 1.3 实现 `render` 子命令（design §2.3）：按目标宽度等比渲染指定页为 PNG，
      输出实际像素与反推 `renderDpi`。
      实测坑：`CGPDFPage.getDrawingTransform` **只缩小不放大**，直接给 2048×1152 的矩形
      会让 960×540 的页 1:1 居中绘制、四周留白；放大必须自己 `scaleBy`。
- [x] 1.4 在根 `package.json` 加 `build:pdf` 脚本（照 `build:vision` 的 `xcrun swiftc` 写法），
      并挂进 `build`。

验证：手工对一份 PDF 跑两个子命令，检查 JSON 与产出 PNG。

## 阶段二：合成测试 PDF

- [x] 2.1 新建 `native/macos-pdf-render/Sources/generate-test-pdf.swift`，
      照既有 `generate-fixture.swift` / `generate-complex-fixture.swift` 的做法，
      用 PDFKit 合成**混合宽高比**的多页 PDF（F4 的 A6 素材）：
      若干 16:9 页 + 若干 A4 横版 / 竖版页。
      实得三份：`mixed-aspect.pdf`（5 页：16:9 / A4 横 / 16:9 / A4 竖 / 16:9 无文字）、
      `no-wide.pdf`（2 页全非 16:9，验 P5）、`password-protected.pdf`（验 3.5 加密路径）。
- [x] 2.2 加 `fixture:pdf` 脚本产出到 `fixtures/pdf-extraction/`。

⚠️ A5 的素材**不合成**：用你从 `~/test/b2-export-strict.pptx` 用 PowerPoint 导出的 PDF
（真实矢量文本层）。合成件带着我们自己的假设，`hasExtractableText` 在真实导出件上才有意义。

## 阶段三：CLI 抽取编排

- [x] 3.1 `apps/cli/src/pdf/render-binary.ts`（未叫 probe.ts：同一个二进制的两个子命令，
      拆成两个文件反而割裂）：`execFile` 调 `probe` / `render`，进程边界解码，
      二进制缺失给「请先运行 pnpm build:pdf」的 `MISSING_DEPENDENCY`（照 `ocr.ts:19`）。
      **偏差**：`apps/cli` 没有 zod 依赖（`openai/helpers/zod` 走的是 openai 自己的依赖树），
      校验按同等强度手写——缺字段 / 类型不符 / 非有限数一律 `INVALID_PROVIDER_RESPONSE`，
      没有任何 `as` 断言绕过。
- [x] 3.2 逐页 16:9 判定：**用 `widthPt/heightPt` 之比 + core 既有容差**，
      不在 Swift 侧判、不用渲染后的像素（design §2.1 / §3）。
- [x] 3.3 调 `render` 渲染合格页 → 逐页 `createSlideWorkspace`，
      填 `ExtractedSource`（`pageNumber` 用 **PDF 原始页号**）。
      **逐页单独调 render**（而非一次批量）：批量调用下一页坏掉会带走整批，
      与 4.1「跳过不中断」冲突。代价是每页一次进程启动。
- [x] 3.4 deck 不存在则初始化、存在则按 `addSlideToDeck` 同一规则追加末尾（design §4）。
      **既有页零改动**：只往 `manifest.slides` 末尾 push。
      **偏差**：`addSlideToDeck` 没有 `source` 参数，抽取页填不了 `ExtractedSource`，
      因此另有一个 `pdf/deck-append.ts`。但**页号规则与建空 deck 不另抄**：直接调用
      子任务③ 从 `deck/` 导出的 `nextPageLabel` 与 `createEmptyDeckWorkspace`，
      两条命令共用同一份编号规则——否则同一个 deck 迟早出现两套页号，
      而混合来源 deck（父任务 A2）正是三条命令交替追加。
- [x] 3.5 加密 PDF（`encrypted: true`）以 `FoundationError` 退出，不交互解锁。
      `encrypted` 的判据是 `PDFDocument.isLocked` 而非 `isEncrypted`——
      只设权限口令的 PDF 能正常渲染，拒绝它是错的。

验证：P1 / P2 / P6 / P8。**P2 须显式断言资产尺寸 == 磁盘 PNG 实际像素**，
不接受「== 目标宽度 2048」——渲染器报的尺寸与磁盘文件可能不符（③ 的 RK1 同源教训）。

## 阶段四：跳过与报告

- [x] 4.1 跳过不中断：单页判定失败或渲染失败记录原因继续下一页。
      跳过原因枚举实得四个：design 列的三个之外加 `page_build_failed`
      （渲染成功但建页失败）——与 `render_failed` 分开，两者排查方向完全不同。
- [x] 4.2 抽取报告落 `<deck>/extractions/<ISO 时间戳>-<docSha 前 8>.json`（design §5），
      `reason` 用结构化枚举 + 人类可读消息。文件名里的 `:` `.` 换成 `-`（Finder 把 `:`
      显示成 `/`），精确时间仍在 JSON 的 `extractedAt`。
- [x] 4.3 退出码：至少建立一页即 0；整份为空才非零，且**不留下半成品 deck**
      （新建路径沿用 `createDeckWorkspace` 的 mkdtemp + rename 原子模式）。
      追加路径下 deck 本来就存在，即使一页都没建成也照常落报告——用户需要看到为什么。
- [x] 4.4 CLI 注册 `deck extract --pdf <file> --deck <path> [--pages <范围>]`。

验证：P4 / P5 / P11。

## 阶段五：验收走查

- [x] 5.1 **P7 抽取页跑完下游**（覆盖形状，不可简化）：取一个抽取出的页，
      继续跑 `ocr` → `review` → `mask` → `pptx` 成功。只验到「抽取成功」不算通过。
      b2 第 1 页跑完全链路，含真实 OpenAI（assist-review）与真实 gpt-image-2（clean），
      pptx 自动检查 passed。复核门由脚本代劳（见 prd.md P7）。
- [x] 5.2 **P3 文本层探测**：用 F4 的真实导出 PDF 验，不接受合成件结论。
- [x] 5.3 P9 自动放行不伪造人工痕迹：抽取页 `accept-source` 为 `completed`
      但磁盘上**没有** `stages/source/accepted.json`。
- [x] 5.4 P10 换源互通：抽取页换源为导入图后来源正确翻转，反向亦然。
- [x] 5.5 **P12 既有工作区零影响**：在 `~/test/ppttest-2026-07-25` 的**副本**上验，
      不在基线本身上跑。**不接受仅凭 fixture 推断。**
- [x] 5.6 逐条勾 P1–P12，标 `[~]` 的写明原因。P1–P12 全部通过，P7 写明了复核门的代劳处。

## 全量验证命令

```bash
pnpm build:pdf                         # 新增；本任务的二进制
pnpm --filter @ppt-maker/core build    # dist 不入库
pnpm typecheck
pnpm test
pnpm format:check                      # 本仓库无 lint 脚本
```

Swift 代码不在 `biome` 覆盖范围内（只查 `apps/*/src`、`packages/*/src`）。

## 风险与回滚点

- **PDFKit 渲染保真度未经实证**。若某类 PDF（透明度 / 特殊字体 / CMYK）渲染异常，
  回滚点是换 `pdftoppm` 作后端——`probe` / `render` 的 JSON 契约不变、TS 侧零改动。
  这是把契约切在二进制边界上的收益，**发现问题时不要改 TS 侧去将就**。
- **macOS 绑定不可逆**：将来要 Windows 得整份重写这个二进制。
  依据是 Apple Vision OCR 已锁死平台，② 不引入新的平台约束。
- **契约漂移**：若实现中发现 `ExtractedSource` 或阶段图需要改动，回父任务改，
  不在②内微调（父任务 design §5 明文要求）。

## 完成定义

- P1–P12 逐条验证，`[~]` 项写明代劳处。
- 全量验证命令通过。
- 父任务 `implement.md` 的 2.2 勾掉并回写实际结论。
