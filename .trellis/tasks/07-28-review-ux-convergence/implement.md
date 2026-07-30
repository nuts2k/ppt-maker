# 执行计划：复核工作台操作体验收敛

阶段顺序由 design §8 的依赖约束决定：**数据正确性先落地，再收界面**。
每个阶段自成一个提交，可单独 revert（唯一例外见「回滚点」）。

## 开工前置（换机器时必读）

**状态（2026-07-28）：规划已完成，代码一行未动。** 四份工件（`prd.md` / `design.md` /
`implement.md` / 两份 jsonl）齐备，任务仍是 `pending`，等用户 review 后再 `task.py start`。
新机器上从「阶段 A」开始即可。

### 环境

| 项 | 要求 | 缺失后果 |
|---|---|---|
| macOS | 必需 | Apple Vision OCR 与 PowerPoint 验收都依赖 |
| Node | ≥ 24（`package.json` engines；本机 v25.6.1，doctor 会报一条偏离 LTS 的警告，不阻塞） | 装不上依赖 |
| pnpm | 10.x（`packageManager: pnpm@10.32.0`） | lockfile 不兼容 |
| Xcode 命令行工具 | `xcrun swiftc` 可用 | `pnpm build` 的 `build:vision` 失败 |
| 微软雅黑字体 | 随 PowerPoint 内置 `msyh.ttc` 提供 | `doctor` 不通过，PPTX 导出被阻止 |
| PowerPoint for Mac | 已安装 | 阶段 C/E 的验收走查无法做 |
| `OPENAI_API_KEY` | 已配置 | `assist-review` 与 clean plate 生成不可用（阶段 A/E 的付费路径验证需要） |

首次准备：

```bash
pnpm install
pnpm build                          # 含 build:vision，需要 xcrun
pnpm test                           # 基线，应全绿
node apps/cli/dist/index.js doctor  # 本机基线：5 通过 / 1 警告（Node 版本）/ 0 失败
```

### 换机清单

仓库外的东西一样都不会跟着 git 走，逐项确认：

| 项 | 位置 | 处理 |
|---|---|---|
| **代码提交** | 2026-07-28 换机前已 `git push origin main`，含本任务的规划工件 | 新机器 `git clone` 或 `git pull` |
| **`.env`** | 仓库根，**已 gitignore** | 手动重建：`OPENAI_API_KEY` 与 `OPENAI_BASE_URL`（第三方兼容端点，两个都要），照 `.env.example` 的键名 |
| **真实工作区** | `~/test/ppttest-2026-07-25`（29 MB） | 整目录拷过去。**它含 2026-07-26 走查的改动**：page-02 的 `block-031/039/045/079/081` 已改分类并入 mask，但受 B5 缺陷影响，mask 及下游产物未跟着更新，manifest 仍显示全部 completed——**这正好是阶段 A 的现成复现场景，别把它清掉** |
| **工作区备份** | `~/test/ppttest-2026-07-25.bak-baseline`（未改动的基线）、`.bak-225336`（上轮走查前） | 各 29 MB。基线那份务必带上，阶段 A 会真实写 manifest，出问题要靠它恢复 |
| **Trellis 当前任务指针** | 会话级，不随仓库走 | 新机器执行 `python3 ./.trellis/scripts/task.py start 07-28-review-ux-convergence`（review 通过后） |
| **跨会话记忆** | `~/.claude/projects/.../memory/` | **不会跟着仓库走**。接续所需信息全部写在本文件与 `prd.md`，以它们为准 |

### 上下文交接要点

新机器上接手时，按这个顺序读最省事：

1. `prd.md` 的 **Background 一节** —— B1–B6 六条现状全部带 `file:line` 锚点，
   不必重新做代码考古；
2. `design.md` 的 **§8 实施顺序与依赖** —— R5 必须先于 R1/R2.4，这是硬约束，不是偏好；
3. 本文件的 **阶段 A** —— 从这里动手。

三条容易踩的坑，都已写在各自章节，这里只做索引：

- `STAGE_LABELS` 保留 `report` 条目，只从 `RUN_STAGE_SEQUENCE` 移除（design §2）；
- 保存失效后必须**先 `clearLiveStages` 再 `refreshSlide`**（design §5.1）；
- 失效判据必须调 core 的 `maskInvalidationProjection`，**不得一律失效 mask**（design §5）。

## 验证命令

```bash
pnpm format:check     # biome（本仓没有 lint 脚本，别写 pnpm lint）
pnpm typecheck        # 递归所有包
pnpm test             # 递归所有包（desktop 用 vitest）
```

单包快跑：

```bash
pnpm --filter @ppt-maker/desktop test
pnpm --filter @ppt-maker/cli test
pnpm --filter @ppt-maker/core test
```

真实工作区走查：`~/test/ppttest-2026-07-25`（29 MB，已含 2026-07-26 走查改动）。
基线备份 `~/test/ppttest-2026-07-25.bak-baseline`。**走查前先拷一份新备份**——本任务的
R5 会真的写 manifest。

## 阶段 A：数据正确性打底（R6 + R5）

无界面改动，先把「改了传得下去」和「report 读对记录」做实。

- [x] A1 `apps/cli/src/report/run.ts`：`clean_record` / `pptx_check` 改按
      `lastSuccessfulAttemptId` + `role` 双条件匹配，口径照抄
      `apps/desktop/src/main/slide-detail.ts:101` 的 `currentSuccessAsset`（R6.1）。
- [x] A2 A1 的单元测试：构造同一 role 两条 attempt 的 manifest 夹具，断言取到后一条。
      落在 `apps/cli/test/`（已有 `slide-run-report.test.ts` 可扩展）。
- [x] A3 新增 `decideInvalidation(previous, next)` 纯函数（design §5 的四行判据表）。
      放桌面端 main 侧，附独立单元测试文件。→ `main/save-invalidation.ts`
- [x] A4 A3 的单元测试覆盖四条分支：`previous === null` / 投影变 / 仅文本变 / 完全相同。
      **投影口径必须调用 core 的 `maskInvalidationProjection`**，不得在测试里另写字段清单。
      → `test/save-invalidation.test.ts`（6 例，夹具复用真实工作区快照 page-01）
- [x] A5 `main/ipc/slide.ts` 的 `slide:save-review` 接入：写盘前读旧文档 → 写盘 →
      按 A3 结果调 `invalidateSlideStage` → 返回值新增 `invalidated`（R5.1）。
      失效原因文案统一为「保存复核内容」。失效时同时写一条活动日志。
- [x] A6 `main/ipc/channels.ts` 与 `preload/index.ts` 同步 `saveReview` 返回类型。
      **两侧类型隔着 `ipcRenderer.invoke`，编译期互不校验**（`stages.ts:68-79` 的教训），
      改一侧必须手动核对另一侧。→ 抽出 `SaveReviewResult` 接口，三处共用同一类型
- [x] A7 `renderer/stores/slide-store.ts` 的 `saveReview` 透传 `invalidated`。
- [x] A8 `ReviewPage.handleSave`：`invalidated` 非空时**先 `clearLiveStages(slideId)`
      再 `refreshSlide(slideId)`**（R5.4 / design §5.1）。顺序不可颠倒，否则会话层旧的
      completed 会盖住刚写下的 stale。
- [x] A9 保存成功提示补充失效信息（例如「保存成功 · 已作废去字底板与 PPTX，点「运行此页」重新生成」），
      让用户知道下一步要做什么。

验证：`pnpm typecheck && pnpm test` → 2026-07-29 全绿（core 76 / desktop 235 / cli 93）。
`pnpm format:check` 通过。

真实工作区手测（这是 A 阶段的核心验收，自动化测试覆盖不到）：

1. 取一个全部阶段 completed 的页，改一个块的分类并保存 → manifest 中 `mask` 及下游转 stale，
   轨道立即变色（AC13、AC15）；
2. 另一个页只改块文本并保存 → `mask` 保持 completed、`pptx` 转 stale，**不触发 clean 的
   付费调用**（AC14）；
3. 打开页面不做任何修改（保存按钮应为 disabled，无法触发）——确认没有「空保存也失效」的路径。

**2026-07-29 数据侧已验证**：在真实工作区 page-02（全阶段 completed）的副本上跑临时用例，
直接调 `decideInvalidation` + `invalidateSlideStage`：

- 改分类 → 判定 `mask`，实际失效 `mask/clean/accept-clean/pptx/accept-pptx/report`；
- 只改文字 → 判定 `pptx`，`mask/clean/accept-clean` 保持 completed（未触发 clean 付费重跑）；
- 不改 → 判定 null，manifest 一字未动。

**界面侧（轨道立即变色、提示文案、保存按钮 disabled）留到阶段 E 走查**——需要真实启动桌面端。

提交：`fix(desktop,cli): 保存复核按粒度失效下游，report 按 attempt 取记录`

## 阶段 B：`report` 移出可见链路（R2）

- [x] B1 `shared/stages.ts`：`RUN_STAGE_SEQUENCE` 移除 `"report"`；`STAGE_LABELS` **保留**
      `report` 条目并放宽其键类型（design §2）。文件顶部注释同步说明这处刻意的不对称。
      → 新增 `StageLabelKey = RunStage | "report"`
- [x] B2 编译期扫残留：`pnpm typecheck` 会因 `RunStage` 收窄而暴露所有仍传 `report` 的位置。
      逐一处理，不得用 `as` 绕过。→ 只暴露一处（`deck-runner.ts:96` 的兜底），即 B3
- [x] B3 `deck-runner.ts:88-99`：删除 `from = "report"` 兜底，`resume === null` 一律
      `continue`；`start` 的空队列文案改写为能表达「已全部完成、无需执行」（R2.4 / design §3）。
      → 文案按点名/批量分开：「所选页面已全部完成，无需执行」/「没有需要执行的页面：活动页均已完成」
- [x] B4 `main/ipc/slide.ts` 的 `slide:accept-final`：`runAcceptFinal` 成功后静默补跑
      `runSlideReport`，失败 catch 后只写活动日志，**不改 IPC 返回类型**（R2.2/R2.3 / design §4）。
- [x] B5 核对受影响的既有测试：`apps/desktop/test/` 下 `stages.test.ts`、`slide-detail.test.ts`、
      `deck-runner.test.ts`、`accept-gate.test.ts`、`slide-nav.test.ts` 均按
      `RUN_STAGE_SEQUENCE` 构造夹具。预期它们不硬编码长度 10，但**必须实跑确认**（design §9）。
      → 实跑后仅 `slide-detail.test.ts` 一条硬编码了「10 个阶段」，已改为 9 并去掉 report 断言；
      其余按序列长度生成夹具的用例无需改动，预期成立。
- [x] B6 `deck-runner.test.ts` 补一条：已全部完成的页被显式点名时不入队。

验证：`pnpm format:check && pnpm typecheck && pnpm test` → 2026-07-29 全绿
（core 76 / desktop 236 / cli 93）。

真实工作区手测（验收自动补跑 report、轨道 9/9）**留到阶段 E**——需要真实启动桌面端走完一页验收。

真实工作区手测：完成一页验收 → 无需任何额外点击，轨道即显示 9/9，`stages/report/report.json`
时间戳已更新（AC4）；随后点批量续跑 → 该页不再被拉进队列（AC5）。

提交：`refactor(desktop): report 移出可见阶段序列，改由验收自动补跑`

## 阶段 C：界面收敛（R1 + R4）

依赖阶段 A：删掉重跑菜单前，保存必须已经能把改动传下去。

- [x] C1 `StageRail.tsx`：删除 `handleStageClick`、`pendingStage` 状态、5 秒超时与
      外部点击退出的 effect、待确认提示条；`StageTrack` 不再传 `onStageClick`（R1.1）。
      顺带删掉 `StageTrack` 已无调用方的 `onStageClick` prop 与按钮分支（留着就是死代码）。
- [x] C2 `StageRail` 头部右侧的「点击阶段点位可从该阶段重跑，已完成阶段需确认」提示删除，
      改为纯状态描述（或直接留空）。→ 仅在本页执行中时显示「执行中」，其余留空
- [x] C3 `StageRail` 错误条新增单个「重跑失败阶段」按钮，调 `onRerunFrom(errorStage)`；
      错误详情里「修正后点击上方对应阶段点位即可从该阶段重跑」改写（R1.4）。
      `errorStage` 为 null 时不渲染该按钮。→ 另加 `isRunStage` 校验：失败阶段来自 manifest
      的任意字符串（可能是已移出序列的 report），不落在执行序列内就不渲染按钮，不做强转
- [x] C4 `SlideToolbar.tsx`：删除「从阶段重跑 ▾」菜单、`menuOpen` 状态、外部点击 effect、
      `onRerunFrom` prop 及 `RUN_STAGE_SEQUENCE`/`STAGE_LABELS` 导入（R1.2）。
- [x] C5 `ReviewPage.tsx`：`SlideToolbar` 的 `onRerunFrom` 透传移除；`rerunFrom` 本身**保留**
      （`FinalConfirmPage` 的「重做底图」与 C3 的错误条仍在用，R1.6）。
- [x] C6 `FinalConfirmPage.tsx`：「重做底板」文案与 tooltip 改写为明说其大概率无效
      （R4.2）；视觉层级降到「回到文本复核」之下（R4.3）。按钮文案统一为「重做底图」
      （PRD 与用户口径），检查同文件内两处空态提示（`:180`、`:193`）的措辞一并对齐。
      → 「回到文本复核」保持 `button-secondary`；「重做底图」降为文字链接并置于其下，
      附一句说明其何时才有用；全仓「重做底板」旧称已清零

验证：`pnpm format:check && pnpm typecheck && pnpm test` → 2026-07-29 全绿
（core 76 / desktop 236 / cli 93）。

真实工作区手测：轨道点位点击无任何反应（AC1）；工具栏无重跑菜单（AC2）；
人为制造一次 clean 失败，确认错误条按钮能正确重跑（AC3）。**留到阶段 E**。

提交：`refactor(desktop): 阶段轨道降为只读，收敛单页执行入口`

## 阶段 D：文本复核列表重构（R3）

本阶段最大，且是用户痛感最强的一块。独立于 A/B/C。

- [x] D1 新增 `renderer/lib/review-filter.ts`（design §6.1 的导出清单）。
      `matchesFilter` 复用 `review-partition.ts` 的 `partitionOf`，不复制判据。
      `ReviewEntryIntent` 也定义在此。
- [x] D2 `review-filter.test.ts`：覆盖 `matchesFilter` 五档、`filterCounts` 计数、
      `defaultFilter` 三种情形、`nextUnreviewedId` 的正常/回绕/无结果。→ 14 例
- [x] D3 `review-partition.ts` 瘦身：删除 `partitionBlocks` / `REVIEW_PARTITION_ORDER` /
      `ReviewPartitionGroup` / `orderedReviewBlocks`；保留 `partitionOf` /
      `REVIEW_PARTITION_LABELS` / `unreviewedBlockIds`。同步改 `review-partition.test.ts`。
      文件头注释改写：分区已不是列表结构，只是每项的标签。
      → 测试里 page-01/page-02 的真实分区计数锚点改用 `partitionOf` 累加后**留住**
- [x] D4 `review-keyboard.ts`：`ReviewKeyAction` 新增 `{ kind: "next-unreviewed" }`，
      判定 `⌘ArrowDown`。**必须排在 `metaKey` 一律 passthrough 的分支之前**，
      且只截获这一个组合，其余 ⌘ 组合继续放行（design §6.4）。
      输入法组字放行保持在最前，不得改动。
- [x] D5 `review-keyboard.test.ts` 补例：⌘↓ 命中、⌘S 仍放行、组字期间 ⌘↓ 也放行。
- [x] D6 `BlockListPanel.tsx` 重构：删除 `PartitionSection`；顶部渲染筛选条（五档 + 计数）；
      主体单一 `<ul>` 直接 `blocks.filter(...).map(...)`，**不排序、不分组**（R3.1）。
      文件头注释写明「列表顺序恒等于 blocks 数组顺序」这条不变量（design §6.2）。
- [x] D7 `ReviewRow` 调整：分区标签改为项内徽标（`partitionOf` 派生）；
      正文按标签选择 `TextDiffRow` / `ClassificationRow` / 只读段落（既有逻辑，判据来源不变）；
      新增「已修改」标记（`updatedAt !== null`，R3.7）；已复核淡化态。
- [x] D8 `stickyIds` 会话集合（design §6.3）：标记已复核时加入；切筛选、切页时清空。
      → 改分类（含 ⌥1/⌥2）也加入，否则改完分类的项会当场退出当前分区档
- [x] D9 `moveBy` 推进域改为当前可见集合；删除跨分区自动展开逻辑。
- [x] D10 「跳到下一个未复核项」接线：调 `nextUnreviewedId`，返回 null 时给明确提示
      （「当前筛选下已无未复核项」），不得静默失败（AC9）。
      → 新增 `onNotice` prop 把提示交给 ReviewPage 的通知条，面板本身仍不持有 UI 状态
- [x] D11 「全部通过」迁移：仅在筛选为「已一致」时出现，作用于该档下的未复核项（R3.8）。
- [x] D12 `ReviewPage.tsx`：新增 `entryIntent` 状态（默认 `"sweep"`）；
      `handleBackToReview` 置 `"targeted"`；`slideId` 变化时复位。透传给 `BlockListPanel`（R3.6）。
- [x] D13 `ReviewShortcutBar.tsx` 更新键位说明，加入 ⌘↓。
- [x] D14 检查 `ReviewPage.tsx:158-168` 的「自动选中首项」effect：
      它现在依赖 `orderedReviewBlocks`（D3 已删），改为取 `blocks[0]`。

验证：`pnpm format:check && pnpm typecheck && pnpm test` → 2026-07-29 全绿
（core 76 / desktop 249 / cli 93）。

真实工作区手测（逐条对应验收标准）：

1. 对任意项按 ⌥1/⌥2 改分类 → **位置不变**、仍在当前筛选内、标签更新（AC7）；
2. 筛选各档计数与条目数一致（AC8）；
3. ⌘↓ 从任意位置跳到下一个未复核项，末项回绕并给提示（AC9）；
4. Enter 标记已复核 → 项留在原位淡化打勾，列表不重排（AC10）；
5. 从最终确认页点「回到文本复核」→ 筛选默认「全部」，且**对比操作前后的
   `text-blocks.json`，确认没有任何块的 `reviewStatus` 被改变**（AC11）；
6. 人工编辑过的块有「已修改」标记（AC12）；
7. 全程仅用键盘完成一页复核（既有硬验收项，不得回退）。

提交：`refactor(desktop): 文本复核改为顺序稳定的线性列表`

## 阶段 E：真实工作区整体走查

- [ ] E1 拷贝新备份后，在 `~/test/ppttest-2026-07-25` 上跑一遍完整流程：
      打开 deck → 批量执行 → 停在文本复核 → 逐项复核 → 保存 → 运行此页 → 最终确认 → 完成。
- [ ] E2 逐条核对 AC1–AC16。不通过的写进本文件并修复，不得只在对话里说。
- [ ] E3 `pnpm format:check && pnpm typecheck && pnpm test` 全绿（AC17）。
- [ ] E4 更新 `.trellis/spec/` 中受影响的前端约定（若有）。
- [ ] E5 归档前把「未能验证的项」「新发现的遗留缺陷」显式写进本文件——
      上一任务正是靠这一节把三条缺陷交接下来的，不要断掉。

## 风险文件

| 文件 | 风险 |
|---|---|
| `shared/stages.ts` | `RunStage` 类型收窄会波及 main / renderer / test 三侧；main 与 renderer 之间隔着无运行时校验的 `ipcRenderer.invoke`，编译期拦不住（`:68-79` 的教训） |
| `main/ipc/slide.ts` | `save-review` 新增写副作用（失效 manifest）。写盘顺序错会让 manifest 与文档不一致 |
| `main/runner/deck-runner.ts` | 兜底逻辑改动直接影响批量执行的入队判据，错了会表现为「点了没反应」或「无限重跑」 |
| `BlockListPanel.tsx` | 整体重构，是复核界面的主操作面。顺序稳定性不变量一旦破坏，本任务收益归零 |
| `review-keyboard.ts` | `metaKey` 分支顺序错会吃掉 ⌘S；组字判定被挪动会砸掉中文输入 |
| `apps/cli/src/report/run.ts` | 本任务唯一的 CLI 改动，注意不要顺手改动其它 report 逻辑 |

## 回滚点

- 阶段 A / B / C / D 各自独立提交，可单独 `git revert`。
- **唯一耦合**：revert 阶段 A（保存粒度失效）时**必须连带 revert 阶段 C**，
  否则用户既没有重跑菜单、保存也传不下去，会被彻底堵死（design §8）。
- 阶段 A 会真实修改工作区 manifest。走查前必须拷贝备份；出问题时从
  `~/test/ppttest-2026-07-25.bak-baseline` 恢复。
