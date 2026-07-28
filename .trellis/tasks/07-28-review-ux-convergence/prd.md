# 复核工作台操作体验收敛

## Goal

M4 桌面端复核工作台已能跑通全链路，但操作面相对真实工作内容严重过宽：用户在一页上真正
会做的只有「文本复核」和「最终验收」两件事，界面却提供 20 个阶段级重跑入口和一个无人消费
的 `report` 阶段；文本复核列表按一个会被编辑动作改变的键分组，导致改完分类的项当场传送到
别处且无法追回。

本任务把桌面端操作面收敛到实际有效的动作集，根治文本复核的定位缺陷，并修掉两条与之硬耦合
的遗留缺陷。不改动 CLI 与 core 的阶段契约。

## Background

### B1 `report` 在桌面端零消费，且在污染批量执行判据

- `packages/core/src/stage-graph.ts:24` — `report: ["accept-pptx"]`，链路末端叶子，无下游。
- 桌面端没有任何界面读取 `stages/report/report.json`；唯一引用是
  `apps/desktop/src/main/runner/deck-runner.ts:96` 的兜底 `from = "report"`。
- `computeResumeStage`（`apps/desktop/src/main/slide-detail.ts:210`）遍历 `RUN_STAGE_SEQUENCE`
  判断整页是否跑完。`report` 未完成时该页**永远不算完成**，每次批量续跑都会把已验收的页
  重新拉进队列。
- `ReviewPage.tsx:232` 注释确认：验收后 `report` 不自动跑，需用户再点一次「运行此页」，
  表现为验收完成后轨道长期停在 9/10。
- 上一任务 PRD 第 199 行本已写明「验收后 `report` 自动补跑至 completed」，实现时未做
  （`07-26-review-flow-simplification/implement.md:423`），用户当时决定留待单独讨论。
  本任务是补这笔账，不是新增需求。
- `report.json` 仍是唯一的结构化留档（自动检查 + 人工接受记录），CLI 的 `formatSlideReport`
  （`apps/cli/src/report/run.ts:349`）在消费，也是未来批量质检的唯一数据源。要削减的是它的
  **可见性**，不是它本身。

### B2 阶段级重跑入口有 20 个，语义有效的只有 2 个

- `StageRail.tsx:118` `handleStageClick` — 轨道 10 个点位全部可点 = 从该阶段重跑，
  已完成阶段需点两次确认（`StageRail.tsx:108-117` 注释自陈是防误触补丁）。
- `SlideToolbar.tsx:263` 「从阶段重跑 ▾」菜单 — 再次列出同样 10 个阶段。
- 用户在待验收态真正需要的动作只有「回到文本复核」与「重做底图」，且后者在不改文本复核
  结果、也不改提示词时产出几乎不变（当前尚不支持改提示词）。
- E1 走查的三个「点了没反应」缺陷全部出在这条路径上
  （`stages.ts:68-79`、`ReviewPage.tsx:262-271`、`implement.md:369`）。
- `SlideCard.tsx:148` 的 `StageTrack` 未传 `onStageClick`，控制台卡片的阶段点位**本来就是
  只读的**，无需改动。

### B3 文本复核：改分类后目标项传送且无法追回

- 分区归属由 `review-partition.ts:46` `partitionOf` **实时派生**：`classification !== "layout_text"`
  → 分类待确认；`layout_text` 且双源逐字一致 → 已一致；否则 → 文字待确认。
- 用户按 ⌥1（`review-keyboard.ts:55` → `BlockListPanel.tsx:134` `setClassification`）改分类的
  瞬间，分组键当场变化，该项被移到另一区；目的地「已一致」默认折叠
  （`BlockListPanel.tsx:85`），于是直接消失在折叠摘要行里。
- `applyManualEdit`（`block-edit.ts:60`）刻意不改 `reviewStatus`，该块仍是 `unreviewed`——
  形成「一个未复核项，但用户看不见它」。
- 现有键盘导航只有逐项推进（`BlockListPanel.tsx:116` `moveBy`），**没有「跳到下一个未复核项」**；
  `ReviewShortcutBar` 与 `SlideToolbar.tsx:217` 均无此入口。
- 病因是结构选错维度：列表按一个会被用户编辑动作改变的键分组。不是滚动或焦点缺陷。

### B4 「回到文本复核」不重置复核状态（2026-07-28 查证结论）

用户关切：回到文本复核时通常只想改少数几处，不希望所有项被重置为未复核。**当前实现不会重置。**

- `handleBackToReview`（`ReviewPage.tsx:318`）只调 `invalidateStage(workspacePath, "mask", ...)`，
  不触碰 `text-blocks.json`。
- `invalidateSlideStage`（`apps/cli/src/slide/invalidate.ts:26`）读 manifest → 调
  `invalidateStageAndDownstream` → 写回 manifest；后者（`stage-graph.ts:83-93`）只改
  `status` / `invalidatedAt` / `invalidationReason` 三个字段。
- 即使 `review` 阶段本身被重跑也安全：`text-blocks.ts:275` 的 `isHumanTouched` 把
  「`reviewStatus` 非 unreviewed / `riskAcceptance` 非 null / `updatedAt` 非 null / 有 manual 来源」
  的块判为人工碰过，`refreshHumanSources` 只刷新候选来源并保留 manual 条目。
- 唯一批量写 `reviewed` 的是 `assist-review.ts:145`，那是把高置信块自动标为已复核，方向相反。

**但派生出一个缺口**：R3 的筛选默认「未复核」时，回到文本复核的场景下未复核数通常为 0，
用户会打开一个空列表，而其真实意图是定向找到要改的几处。见 R3.6。

### B5 遗留缺陷一：保存复核不失效下游，改动传不到产物

来源 `07-26-review-flow-simplification/implement.md:425`，2026-07-26 真实工作区走查发现，
属既有缺陷。

- 现象：在全部阶段已 completed 的页上改复核内容并保存，界面仍显示「完成」，但
  mask/clean/pptx 产物不更新——底板里那几块字没被抹掉，PPTX 却已给它们生成文本框。
- 链路：`slide:save-review`（`main/ipc/slide.ts:70`）只写文件 + 内存校验，不调用任何失效逻辑
  → `computeResumeStage` 全部 completed 时返回 null → `deck-runner.ts:93` 把显式点名单页的
  起点兜底成 `report`，于是 mask 及以后一步都不执行。
- `mask/run.ts:376` 本身有正确的指纹判断，问题是它根本没被调用到。
- **与 R1 构成硬依赖**：该缺陷唯一的临时绕行方案正是「工具栏『从阶段重跑 → 文字校验』」
  （`implement.md:445`），而 R1 要删掉这个菜单。不先修此缺陷，R1 会把用户彻底堵死。

### B6 遗留缺陷二：report 取产物记录按 role 取第一条

来源 `07-26-review-flow-simplification/implement.md:447`，2026-07-27 发现，属既有缺陷。

- `apps/cli/src/report/run.ts` 取 `clean_record` / `pptx_check` 资产时按 `role` 取第一条匹配项，
  未按阶段的 `lastSuccessfulAttemptId` 过滤。clean 跑过两次的页会拿到已被取代的那次记录
  （真实工作区 page-01 的 `clean_record` 有 clean-001 与 clean-002 两条）。
- **与 R2 构成放大关系**：R2 让 report 从「用户偶尔手动跑」变成「每页验收后必跑」，
  该缺陷随之从偶发变为系统性。
- 修复口径现成：桌面端 `readFinalChecks` 的 `currentSuccessAsset`
  （`main/slide-detail.ts`）已按 `lastSuccessfulAttemptId` 匹配，并用真实工作区验证读出
  `outsideMaskDiff = 0.0439`（clean-002 的值）。

## Requirements

### R1 阶段轨道降为只读状态指示

- R1.1 `StageRail` 的阶段点位不再可点击，移除 `handleStageClick`、`pendingStage` 双击确认态
  及其超时/外部点击退出逻辑（`StageRail.tsx:48-132`、`166-171`）。
- R1.2 删除 `SlideToolbar` 的「从阶段重跑 ▾」菜单及其 `onRerunFrom` 透传
  （`SlideToolbar.tsx:248-280`）。
- R1.3 轨道继续常驻可见并保留全部状态色与阶段名——阶段状态可见性是用户明确认可的价值。
- R1.4 失败态保留重跑入口，但改为挂在 `StageRail` 错误条上的**单个**按钮（重跑失败阶段），
  不再依赖整条轨道可点。错误条现有文案「修正后点击上方对应阶段点位即可从该阶段重跑」
  （`StageRail.tsx:230`）需同步改写。
- R1.5 单页可用的执行动作收敛为：`运行此页`（`SlideToolbar`）、`回到文本复核` 与
  `重做底图`（`FinalConfirmPage`）、`重跑失败阶段`（错误条，仅失败时出现）。
- R1.6 `rerunFrom` 保留（`FinalConfirmPage` 的「重做底图」与 R1.4 的错误条按钮仍在用），
  但不再由轨道与菜单调用。

### R2 `report` 移出可见链路，由验收自动补跑

- R2.1 `shared/stages.ts` 的 `RUN_STAGE_SEQUENCE` 移除 `report`；该序列只服务桌面端，
  CLI 有独立序列，不受影响。轨道变 9 格。
- R2.2 `slide:accept-final`（`main/ipc/slide.ts:174`）在 `runAcceptFinal` 成功后静默补跑一次
  report，产物照常落盘。
- R2.3 report 补跑失败**不翻转验收结论**：验收记录此时已写盘，只在活动日志记一条失败。
  与 `ReviewPage.tsx:192` 处理 `refreshSlide` 失败的既有口径一致。
- R2.4 `deck-runner.ts:96` 的 `from = "report"` 兜底随之失效，需一并处理：显式点名一个
  已全部完成的页时不应再退化成只跑 report。

### R3 文本复核改为顺序稳定的线性列表 + 筛选条

- R3.1 拆掉三分区分组结构（`BlockListPanel` 的 `PartitionSection`）。列表顺序恒等于
  `text-blocks.json` 的存储顺序（阅读顺序），**任何编辑都不改变任何一项的位置**。
- R3.2 「文字待确认 / 分类待确认 / 已一致」由分组结构降级为**每项上的标签**，随编辑实时变化
  但不引起移动。判据仍独占来自 `review-partition.ts` 的 `partitionOf`（其内部只认 core 的
  `compareBlockSources`），不得复制口径。
- R3.3 顶部筛选条：`未复核 N` / 文字待确认 / 分类待确认 / 已一致 / 全部，各带计数。
  筛选键是 `reviewStatus` 与标签，**改分类不会把项移出当前筛选结果**。
- R3.4 标记已复核后该项**留在原地打勾淡化，不即时移除**；淡化项在切换筛选或重进页面时清走。
  即时移除会让列表在操作瞬间重排，等于把 B3 换个形式请回。
- R3.5 新增「跳到下一个未复核项」动作并绑定快捷键，判定逻辑落在
  `review-keyboard.ts` 的纯函数里（保持该文件既有的可测性约定）。
- R3.6 筛选默认值按上下文决定，不写死：有未复核项时默认「未复核」（清扫模式）；
  未复核数为 0、或从 `FinalConfirmPage` 点「回到文本复核」进入时默认「全部」（定向修改模式）。
- R3.7 列表项显示「本次已修改」轻标记，判据为 `updatedAt` 非空——`applyManualEdit` 不改
  `reviewStatus`，用户改过哪几块目前在界面上完全看不出来。
- R3.8 「全部通过」迁移为「通过全部『已一致』项」，仍只对已一致标签开放（其余需逐项过目，
  给批量入口等于把 F-6 的「一键全标已复核」搬回来）。
- R3.9 保留既有键盘流约定：输入法组字期间一律放行（`review-keyboard.ts:45`）、
  ⌘/Ctrl 组合放行、焦点在按钮上时 Enter 放行。

### R4 最终确认页文案与层级

- R4.1 「重做底图」保留。clean 会真失败或真产出坏底板（`CheckSummary` 正在展示残留像素与
  mask 外改动率），无重试入口即另一种堵死。
- R4.2 改写其说明文案，从只讲代价改为明说其大概率无效：未修改文本复核内容时重新生成的底板
  通常与当前一致，仅在底板明显异常（文字残留、容器被改坏）时使用
  （现文案见 `FinalConfirmPage.tsx:272`）。
- R4.3 「重做底图」视觉层级降到「回到文本复核」之下。`FinalConfirmPage` 主结构
  （主按钮「完成」+ 两个退回动作）不重构。

### R5 保存复核按粒度失效下游（修 B5）

- R5.1 `slide:save-review` 写盘前读取旧文档，用 core 的 `maskInvalidationProjection`
  （`packages/core/src/text-blocks.ts:426`）比对：投影变了失效 `mask`；只有文本/样式变了
  失效 `pptx`；都没变则不失效。
- R5.2 **不得一律失效 `mask`**：`invalidate.ts` 的语义是「强制重做而不是幂等跳过」，
  那会让每次保存都触发一次 clean 的付费调用。
- R5.3 复用既有的变更粒度矩阵（`apps/cli/test` 的「变更粒度失效矩阵」用例）作为口径来源。
- R5.4 失效结果需反映到界面：保存后轨道应能看到下游转 stale，不得出现「磁盘 stale、轨道一片绿」
  （`implement.md:369` 记录的会话层覆盖耐久层问题，`clearLiveStages` 已是既有解法）。

### R6 report 产物记录按 attempt 匹配（修 B6）

- R6.1 `apps/cli/src/report/run.ts` 取 `clean_record` / `pptx_check` 时按阶段的
  `lastSuccessfulAttemptId` 过滤，口径照抄 `main/slide-detail.ts` 的 `currentSuccessAsset`。

## Acceptance Criteria

- [ ] AC1 单页视图中，阶段轨道上的任何点位点击都不触发重跑；轨道仍完整显示 9 个阶段的
      状态色与阶段名。
- [ ] AC2 `SlideToolbar` 上不存在「从阶段重跑」菜单；单页可用的执行动作恰为 R1.5 所列四项。
- [ ] AC3 某阶段失败时，`StageRail` 错误条上出现单个「重跑失败阶段」按钮，点击后该阶段
      及下游转 stale 并从该阶段重跑（不复现「点了没反应」）。
- [ ] AC4 完成一页验收后，无需任何额外点击，轨道即显示 9/9 全部完成，且
      `stages/report/report.json` 已更新。
- [ ] AC5 批量续跑时，已验收完成的页不再被重新拉进队列。
- [ ] AC6 report 补跑失败时，界面仍显示验收成功，活动日志中有一条对应的失败记录。
- [ ] AC7 在文本复核列表中对任意一项按 ⌥1/⌥2 改分类，该项在列表中的**位置不变**、
      仍处于当前筛选结果内，其标签同步更新。
- [ ] AC8 筛选条各档的计数与实际条目数一致；筛选「未复核」时的条目集合等于
      `reviewStatus === "unreviewed"` 的块集合。
- [ ] AC9 「跳到下一个未复核项」快捷键能从任意位置跳到下一个未复核项；已到末项时的行为
      明确且不静默失败。
- [ ] AC10 标记某项已复核后，该项仍显示在原位置（淡化打勾），列表不发生重排。
- [ ] AC11 从最终确认页点「回到文本复核」进入时，筛选默认为「全部」，且**没有任何块的
      `reviewStatus` 被改变**（对比操作前后的 `text-blocks.json`）。
- [ ] AC12 人工编辑过的块（`updatedAt` 非空）在列表项上有可见的「已修改」标记。
- [ ] AC13 在全部阶段 completed 的页上改块分类并保存后，manifest 中 `mask` 及其下游转 stale；
      点「运行此页」能把改动带到 clean/pptx 产物。
- [ ] AC14 只修改块文本（不影响 mask 投影）并保存后，`mask` 保持 completed、`pptx` 转 stale，
      不触发 clean 的付费调用。
- [ ] AC15 保存后阶段轨道立即反映 stale 状态，不出现「磁盘 stale、轨道一片绿」。
- [ ] AC16 对 clean 跑过两次的页生成 report，`clean_record` 指标取自最后一次成功的 attempt
      （真实工作区 page-01 应读出 `outsideMaskDiff = 0.0439`）。
- [ ] AC17 `pnpm format:check`、`pnpm typecheck`、`pnpm test` 全绿
      （本仓无 `lint` 脚本，格式检查走 biome 的 `format:check`）。

## Out of Scope

- **底图生成的可控性**（提示词入口、按页覆盖、结果对比）。用户真正想要的是「能调整底图生成」
  而非「重跑一遍看运气」，但那是需要独立设计的新能力，塞进界面收敛会让范围失控。另立任务。
- **无法切换工作区，换 deck 只能重启应用**（`07-26-review-flow-simplification/implement.md:365`）。
  与本任务无关，另立任务。
- 控制台侧（`ConsolePage` / `SlideCard` / `TodoQueuePanel`）的结构改动：卡片阶段点位本就只读
  （`SlideCard.tsx:148`），`todo-queue.ts:193` 已做到空组不渲染，正常流程下用户看到的就是
  「需文本复核」与「待最终确认」两组。无需改动。
- CLI 与 core 的阶段契约、`RUN_STAGE_SEQUENCE` 之外的执行序列。
