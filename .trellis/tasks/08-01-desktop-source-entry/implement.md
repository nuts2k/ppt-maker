# 子任务④ 执行计划

设计在 `design.md`，范围与验收在 `prd.md`。本文件只管执行顺序、验证与回滚点。

**动手前必读**（父任务 HANDOFF 点名）：

1. `DESIGN.md` —— CLAUDE.md 的硬约束，所有前端视觉设计必须遵从
2. `.trellis/spec/backend/contracts.md` —— 尤其〈多代资产与「当前产物」选取契约〉
3. `.trellis/spec/frontend/state-management.md` —— 六条均由真实缺陷验证
4. `.trellis/spec/guides/silent-failure-thinking-guide.md`
5. `.trellis/spec/guides/verification-coverage-thinking-guide.md`

## 阶段一：数据面（U1 的前置，其余全部依赖）

- [x] 1.1 **类型挪进 core**（`design.md` §2.3）：`SpecDriftStatus`、`PdfExtractionReport`
      及其四个子类型与 zod schema 移入 core；`writeExtractionReport` /
      `formatExtractionReport` / `extractionReportRelativePath` 与漂移计算逻辑**留在 CLI**。
      CLI 侧按需 re-export 过渡。
      **验证**：`pnpm -r build && pnpm -r typecheck && pnpm -r test` 零回归 —— 这是纯类型
      移动，任何测试变红都说明动到了行为，立即停下查清楚。
- [x] 1.2 `DeckStatusSlide` 增 `sourceKind` / `specEntryId` / `specDrift` 三个字段并在
      `buildDeckStatus` / `buildDeckStatusDetailed` 透传。
      **不接** `blockingStage` / `started`（理由见 `design.md` §2.2）。
- [x] 1.3 守住 §2.1：`channels.ts` 不得出现任何 `@cli/*` 导入。
      **验证**：加一条静态断言测试（`rg` 扫 `channels.ts` 的 import），
      否则这条约束只活在注释里，下一个人照样会踩。

## 阶段二：卡片来源与漂移标注（R6 → U1 / U11）

- [x] 2.1 `SlideCard` 缩略图左上角加来源徽标：`caption` 尺寸、`ink-muted`、**不上色**，
      与 `removed` 徽标互斥。
- [x] 2.2 详情行插入漂移文案，优先级排在 `todoReason` **之后**、进度描述之前
      （`SlideCard.tsx:136` 的既有优先级链）。`drifted` → 「规格已更新」，
      `missing` → 「规格条目已失联」，色取 `state-stale`。
- [x] 2.3 **回归锁**：一条用例断言漂移页不进入 `deriveTodoQueue`、阶段状态不变。
      父任务 A13 的核心就是「漂移不污染」，没有这条锁，将来任何人改待办判据都可能顺手
      把漂移塞进去。

**此时可自验 U1、U11**（手工改一个 deck 的规格文件第 4 页，看只有第 4 页标注、改回消失）。

## 阶段三：长任务通道与互斥（R5 → U12）

- [x] 3.1 新增 `deck:source-task-start` 与 `deck:source-task-progress`；main 侧把
      `extractPdfToDeck` 的 `onProgress(string)` 与 `runDeckGenerate` 的
      `onProgress(DeckGenerateProgress)` 归一为同一形状再送 renderer。
- [x] 3.2 双向互斥（`design.md` §4.2）：runner 在跑 → 拒绝建页任务并说明原因；
      建页任务在跑 → 「处理全部」与「运行此页」禁用且 `title` 写明理由。
      建页任务自身串行单例。
- [x] 3.3 **竞态守卫**（RK-D）：建页任务响应到达时比对 `deckPath` 身份，不一致即丢弃，
      **失败路径同样守**。
      **验证**：按 `state-management.md` 的要求，用 deferred 复现「请求发出 → 期间切换 →
      迟到响应到达」，每处守卫配一条正对照，写完把守卫逐处改成 `if (false)` 做变异验证，
      该红的必须红。
- [x] 3.4 一条回归用例：runner 运行中启动建页任务被拒绝。

## 阶段四：来源选择界面（R2 / R3 / R4 → U2 / U3 / U6）

- [x] 4.1 `SourcePicker` 模态骨架 + 三档切换。**先读 `DESIGN.md`**：primary 全屏唯一、
      六态齐全、焦点环用 `:focus-visible`、动效 150–250ms 且带 `prefers-reduced-motion` 分支。
- [x] 4.2 两个入口接进去：`DeckEmptyState` 主行动改「新建 Deck」；`ConsolePage`
      的「添加页面」改为进同一模态（目标 = 当前 deck，追加到末尾）。
      「打开已有 Deck」保持不变。
- [x] 4.3 `imported` 档：新建选目录、追加选一个或多个图片文件。
- [x] 4.4 `extracted` 档：选文件 + 页码范围输入框，**原样传给 CLI，不解析不校验**；
      非法输入由 CLI 报错、界面照常显示原因。
- [x] 4.5 `generated` 档两条路（E1）：选已有规格文件 / 构思文本 → `runDeckSpecDraft`
      → **展示条目数与逐页标题 → 用户确认后**才 `runDeckGenerate`。不连跑。

**此时可自验 U2、U3、U6。** U3 要真的在同一个 deck 上三档各追加一次，
并逐页比对既有页的阶段状态与已确认产物零变化。

## 阶段五：抽取报告呈现（R8 → U4 / U5）

- [x] 5.1 完成面板：建立 N / 跳过 M，跳过逐条给页号、尺寸与原因。
      原因文案**直接用报告里的 `reason.message`**（② 已写好完整中文），
      `reason.code` 只用于分组，不在桌面端重拼文案。
- [x] 5.2 `ActivityRecord` 增可选 `reportPath`；`ActivityPanel` 对带该字段的记录给
      「查看报告」重新打开面板。旧 jsonl 记录读出来是 `undefined`，天然兼容。
- [x] 5.3 用 `fixtures/pdf-extraction/` 下的混合宽高比与全非 16:9 两份合成 PDF 自验 U5。

## 阶段六：审片视图（R7 → U7 / U8 / U9 / U10）

- [x] 6.1 **先只加第三个 `AppView` 与路由**，`ui-store` 的 `INITIAL_STATE` 与 `reset()`
      一并覆盖，切换工作区回落 `console`。
      **此步单独跑一次全量测试确认零回归**（RK-B），再往下接内容。
- [x] 6.2 序列取 `deriveTodoQueue` 的 `confirm-source` 组，**不另写 filter**。
- [x] 6.3 拆原子判据（RK-E）：源图侧照 `accept-gate.ts` 已有的
      `pptxReady` / `finalAccepted` / `awaitingFinalConfirm` 形状补齐「可达」与「待办」两个口径，
      **不得**用 `awaitingSourceConfirm` 兼任入口可见性。
      **回归锁**：已确认的 `generated` 页仍可进入审片视图（U10）。
- [x] 6.4 布局与动作（`design.md` §5.3）：大图、等宽计数、接受/重新生成/换源，
      回车接受并跳下一张，`←/→` 切页，`Esc` 返回。「换源」直接复用
      `window.api.slide.replaceSource`，不写第二套。
- [x] 6.5 三个入口：待办队列组标题的「逐张确认」、生成完成面板的「去确认」、
      停在源图确认的 `generated` 页点卡片直达。
- [x] 6.6 接受 / 重新生成后的刷新要齐：会话层 `clearSessionResult` + `clearLiveStages`、
      耐久层 `refreshSlide`、图片重新拉取。
      **少一样就会出现「界面说的和磁盘不一样」**——`ReviewPage.tsx:434` 的换源编排
      已经踩过并写了注释，照它写。

## 阶段七：付费门槛（R9 → U13）

- [x] 7.1 批量生成前原生 `messageBox`，写明「将调用 N 次图像生成，不可撤销」。
- [x] 7.2 单张重新生成二次点击：文案变「确认重新生成？」，失焦或超时复位。
- [x] 7.3 规格初稿按钮明示「将调用模型生成初稿」。
- [x] 7.4 `RunControlBar.tsx:54` 的 `confirmApi/confirmUpload` **不改** —— 流水线的云调用
      是「处理全部」的直接后果且不按张计费，与生成不是同一回事。

## 验证命令

```bash
pnpm --filter @ppt-maker/core build   # dist 不入库，typecheck 前必须先 build
pnpm -r build
pnpm format:check                     # 本仓库没有 lint 脚本，风格检查是这条
pnpm -r typecheck
pnpm -r test
```

真机走查需要 `.env` 的 `OPENAI_API_KEY` / `OPENAI_BASE_URL`（第三方网关），
云调用由开发者显式触发。

**走查素材**：`~/test/ppttest-2026-07-25`（M3/M4 旧格式基线，一律**复制**后验）；
`~/test/b2-export-strict.pdf`（真实 PowerPoint 导出件，含矢量文本层）；
`fixtures/pdf-extraction/`（混合宽高比、全非 16:9、加密三份合成 PDF）。

## 回滚点

| # | 触发 | 动作 |
|---|---|---|
| RK-A | 1.1 的类型移动引发连锁改动超出预期 | 回滚为 `design.md` §2.3 的备选 DTO 方案（channels.ts 自声明 + main 侧映射），代价是重复定义一份 schema |
| RK-B | 6.1 的第三个 `AppView` 打破既有导航测试 | 该步独立提交，可单独回退；接入口的工作全在 6.5，未接之前新视图不可达 |
| RK-C | 建页任务与 runner 并发写 manifest | 3.2 的互斥是硬防线，3.4 的用例是它的锁 |
| RK-D | 新建 deck 激活既有竞态 | 3.3 的守卫 + 变异验证 |
| RK-E | 审片视图误用 `awaitingSourceConfirm` 当入口判据 | 6.3 拆判据 + U10 回归锁 |

## 完成定义

- U1–U14 全部通过，走查证据记入本任务
- 阶段一的 core 类型移动为纯类型变更，CLI 与桌面端测试零回归
- 父任务 `implement.md` 的 2.4 勾选，并把 ④ 的结论回写父任务
