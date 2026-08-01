# 子任务② 执行计划

顺序按依赖排。②不改 core 契约，风险显著低于①③。

## 阶段一：Swift 渲染二进制

- [ ] 1.1 新建 `native/macos-pdf-render/Sources/main.swift`，照
      `native/macos-vision-ocr/Sources/main.swift` 的结构（单文件、argv 入参、stdout JSON）。
- [ ] 1.2 实现 `probe` 子命令（design §2.2）：页数、每页 `widthPt/heightPt`
      （`PDFPage.bounds(for: .mediaBox)`）、`hasExtractableText`（`PDFPage.string` 去空白非空）、
      `encrypted`、`rendererVersion`（版本常量 + `ProcessInfo.operatingSystemVersion`）。
- [ ] 1.3 实现 `render` 子命令（design §2.3）：按目标宽度等比渲染指定页为 PNG，
      输出实际像素与反推 `renderDpi`。
- [ ] 1.4 在根 `package.json` 加 `build:pdf` 脚本（照 `build:vision` 的 `xcrun swiftc` 写法），
      并挂进 `build`。

验证：手工对一份 PDF 跑两个子命令，检查 JSON 与产出 PNG。

## 阶段二：合成测试 PDF

- [ ] 2.1 新建 `native/macos-pdf-render/Sources/generate-test-pdf.swift`，
      照既有 `generate-fixture.swift` / `generate-complex-fixture.swift` 的做法，
      用 PDFKit 合成**混合宽高比**的多页 PDF（F4 的 A6 素材）：
      若干 16:9 页 + 若干 A4 横版 / 竖版页。
- [ ] 2.2 加 `fixture:pdf` 脚本产出到 `fixtures/pdf-extraction/`。

⚠️ A5 的素材**不合成**：用你从 `~/test/b2-export-strict.pptx` 用 PowerPoint 导出的 PDF
（真实矢量文本层）。合成件带着我们自己的假设，`hasExtractableText` 在真实导出件上才有意义。

## 阶段三：CLI 抽取编排

- [ ] 3.1 `apps/cli/src/pdf/probe.ts`：`execFile` 调 `probe`，zod 校验，
      二进制缺失给「请先运行 pnpm build:pdf」的友好报错（照 `ocr.ts:19`）。
- [ ] 3.2 逐页 16:9 判定：**用 `widthPt/heightPt` 之比 + core 既有容差**，
      不在 Swift 侧判、不用渲染后的像素（design §2.1 / §3）。
- [ ] 3.3 调 `render` 渲染合格页 → 逐页 `createSlideWorkspace`，
      填 `ExtractedSource`（`pageNumber` 用 **PDF 原始页号**）。
- [ ] 3.4 deck 不存在则初始化、存在则按 `addSlideToDeck` 同一规则追加末尾（design §4）。
      **既有页零改动**：只往 `manifest.slides` 末尾 push。
- [ ] 3.5 加密 PDF（`encrypted: true`）以 `FoundationError` 退出，不交互解锁。

验证：P1 / P2 / P6 / P8。**P2 须显式断言资产尺寸 == 磁盘 PNG 实际像素**，
不接受「== 目标宽度 2048」——渲染器报的尺寸与磁盘文件可能不符（③ 的 RK1 同源教训）。

## 阶段四：跳过与报告

- [ ] 4.1 跳过不中断：单页判定失败或渲染失败记录原因继续下一页。
- [ ] 4.2 抽取报告落 `<deck>/extractions/<ISO 时间戳>-<docSha 前 8>.json`（design §5），
      `reason` 用结构化枚举 + 人类可读消息。
- [ ] 4.3 退出码：至少建立一页即 0；整份为空才非零，且**不留下半成品 deck**
      （新建路径沿用 `createDeckWorkspace` 的 mkdtemp + rename 原子模式）。
- [ ] 4.4 CLI 注册 `deck extract --pdf <file> --deck <path> [--pages <范围>]`。

验证：P4 / P5 / P11。

## 阶段五：验收走查

- [ ] 5.1 **P7 抽取页跑完下游**（覆盖形状，不可简化）：取一个抽取出的页，
      继续跑 `ocr` → `review` → `mask` → `pptx` 成功。只验到「抽取成功」不算通过。
- [ ] 5.2 **P3 文本层探测**：用 F4 的真实导出 PDF 验，不接受合成件结论。
- [ ] 5.3 P9 自动放行不伪造人工痕迹：抽取页 `accept-source` 为 `completed`
      但磁盘上**没有** `stages/source/accepted.json`。
- [ ] 5.4 P10 换源互通：抽取页换源为导入图后来源正确翻转，反向亦然。
- [ ] 5.5 **P12 既有工作区零影响**：在 `~/test/ppttest-2026-07-25` 的**副本**上验，
      不在基线本身上跑。**不接受仅凭 fixture 推断。**
- [ ] 5.6 逐条勾 P1–P12，标 `[~]` 的写明原因。

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
