# Journal - nuts2k (Part 1)

> AI development session journal
> Started: 2026-07-20

---



## Session 1: 完成 M0 项目骨架与技术基线

**Date**: 2026-07-20
**Task**: 完成 M0 项目骨架与技术基线
**Branch**: `main`

### Summary

建立 Node 24/pnpm/TypeScript 工程基线，验证 Apple Vision 离线 OCR、16:9 坐标与 PptxGenJS/PowerPoint 链路，补齐 backend 可执行规范并归档 M0。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `2698695` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete

## Session: M4 V2 重构规划（体验推倒重来）

**Date**: 2026-07-23
**Task**: 07-22-desktop-review-workbench（仍 in_progress，回滚至 Plan 阶段后完成 V2 规划）
**Branch**: `main`

### Summary

V1 桌面工作台被判定用户体验不合格（无批量执行、无进度/错误可见性、状态徽标不含阶段名、pipeline 状态全局单例不落盘）。完成 V2 重构规划并提交，**尚未开始实施**。

### 关键决策（详见任务 prd.md）

- D1 批量优先·控制台：一键处理全部 + 卡片阶段轨道 + 待办队列
- D2 保留画布内核（ReviewCanvas/TextBlockOverlay/TextEditor/SliderCompare），壳层与 Deck 层重写
- D3 阶段级进度 + 实时计时，不改 packages/core 与 apps/cli
- D4 活动日志落盘 Electron userData jsonl，不写 deck 工作区

### Git Commits

| Hash | Message |
|------|---------|
| `5c4c77c` | docs(m4): V2 重构规划 — 批量优先控制台 + DESIGN.md 设计系统 |

### Status

[OK] 规划完成，等待实施

### Next Steps

- 从 implement.md **阶段 A**（main 进程 DeckRunner + ActivityLog + deck:status-detailed）开始，按 A→E 顺序推进，每阶段 commit
- 上下文加载顺序：implement.jsonl → prd.md → design.md → implement.md（全部在任务目录内，不依赖任何本机记忆）
- 验证需准备真实测试 deck（16:9 截图）；跑过 assist-review/clean 需 API 环境变量


## Session 2: M4 E4 端到端走查：修复四处静默失败并沉淀诊断路径

**Date**: 2026-07-25
**Task**: M4 E4 端到端走查：修复四处静默失败并沉淀诊断路径
**Branch**: `main`

### Summary

真实 deck 端到端走查 M4 桌面复核工作台，暴露并修复 4 个缺陷（连同上轮 3 个共 7 个），共同特征是失败被静默吞掉、界面表现均为「点了没反应」：(1) accept-clean 提示缺底板但产物齐全——loadSlide 只依赖 workspacePath，图是进页快照，闸门却走事件驱动，新增 reloadImages 在 pageBusy 边沿刷新并加切页竞态守卫；(2)「重跑」连点 6 次无反应——run-from 守卫与 isStageReusable 都只认 completed，显式重跑被当断点续跑跳过（日志显示每次 run 仅 2ms 且无 stage-start），根因是仓库 6 处失效调用清一色为「指纹变化」，缺「人工判定不合格」路径，新增 invalidateSlideStage 打通 slide:invalidate-stage 通道；(3) report 跑成功但收尾只写 assets、不写 stages/attempts，状态恒 pending——既有 5 个用例全部只断言报告内容、无一碰 manifest 状态，故存活至端到端走查；(4) 缺陷 2 修复的副作用：阶段点位误触从无害变为作废下游并重调付费 API，加已完成阶段二次确认。E4 五步全通过，两页 10 阶段 completed，导出原生 2 页、PowerPoint 确认无误。294 测试全绿。spec 沉淀：backend/contracts.md 新增「阶段落库与强制重跑契约」7 段式、新建 guides/silent-failure-thinking-guide.md、frontend/state-management.md 补一条 Common Mistakes。另记三项遗留未改：网关不遵守 size 参数（请求 2048x1152 实返 1672x940，size.ok 恒 false 是正确检测）、clean_plate asset 尺寸硬编码与磁盘不符、accept-clean 清单与自动检查一一对应且勾选不落库。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `cc98634` | (see git log) |
| `2e04671` | (see git log) |
| `618f81e` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete

---

## 2026-07-26 — 复核链路简化 阶段 A + B

### Summary

任务 `07-26-review-flow-simplification` 的后端两阶段落地。阶段 A（core 契约）：新增 `LAYOUT_TEXT_MUST_BE_MASKED` 校验堵死「版式文字未入 mask → 导出重影」这条此前无任何一层报错的静默漏洞（PRD F-8），`REVIEW_VALIDATION_RULES_VERSION` 升 v2，`buildFreshBlock` 的 `includeInMask` 默认值改为随分类走，新增 `compareBlockSources` 作为双源比对的唯一判据，把 `resolveFontSizePt`/`toAlign`/`toValign`/`toBold`/`fontSizePtFromPx` 从 `apps/cli/src/pptx/synthesize.ts` 纯搬迁到 `packages/core/src/pptx-text-style.ts` 供合成预览与导出同源。阶段 B（CLI 门）：mask 前插入 human-edit 门（此前靠 mask 抛 `INVALID_STAGE_STATE` 代偿，用户看到的是「阶段执行失败」而非「等你复核」，即 F-11），accept-clean 直通不再设停点，新增 `slide accept-final` 一次写入两条验收记录且重试幂等。

**实施中发现的计划缺口**：design §3.2 只写了改 `assertAcceptedCleanPlate`，但 `STAGE_DEPENDENCIES.pptx = ["accept-clean"]` 会让 `assertStageDependenciesCompleted` 先一步拒绝——只改断言不够。用户当场确认采用「改依赖图为 `pptx: ["clean"]`」方案。安全属性经测试与实测核对未削弱：clean 失效仍连带 pptx 及下游失效，`deck export --strict` 仍要求每页 accept-pptx completed，mask/pptx 兜底门禁原样保留。已知语义收窄：单独失效 accept-clean 不再连带失效 pptx（新流程下 accept-clean 只在最终确认时写入，可接受）。

### Git Commits

| Hash | Message |
|------|---------|
| `e03af4a` | feat(core): 阶段 A — 堵死 layout_text 重影漏洞并把字号公式提到 core |
| `a0de457` | feat(cli): 阶段 B — 五个人工门收敛为文本复核门 + 最终产物确认 |

### Testing

- 全量 38 个测试文件 / 316 例通过（基线 36/294，新增 22 例、2 例既有断言按新契约更新）
- `pnpm format:check` / `typecheck` / `build` 全绿
- `measure.py` 数据快照复现 PRD 分区数字：page-01 = 25/16/19，page-02 = 45/18/32
- 真实工作区实测（`~/test/ppttest-2026-07-25` 副本，原始未动）：block-045 被新校验拦下且 rulesVersion 为 v2；human-edit 门正确停顿并报待复核数；accept-clean 置 pending 时 pptx 仍能合成；accept-final 重复调用 ID 不变、attempt 不增；`deck export --strict` 拒绝未验收页、验收后导出 2 页原生

### Status

[WIP] 阶段 A、B 完成；C（文本复核界面 15 项）、D（最终确认页 9 项）、E（走查收尾 6 项）待做

### Next Steps

- 阶段 C 从 C1 `lib/review-partition.ts` 起，分区判据必须 import core 的 `compareBlockSources`，勿重写
- 实现前先读 `DESIGN.md` 与 `.trellis/spec/frontend/`（component-guidelines、state-management、type-safety）
- 环境已就绪：依赖已装、`~/test/ppttest-2026-07-25.bak-baseline` 为基线备份


## Session 3: M4 复核链路简化收尾：E2 兼容性验证、PRD 验收核对与 spec 沉淀

**Date**: 2026-07-28
**Task**: M4 复核链路简化收尾：E2 兼容性验证、PRD 验收核对与 spec 沉淀
**Branch**: `main`

### Summary

完成阶段 E 全部六项。E2 验证既有工作区无需迁移（与基线零差异、deck status 完成 2/2、桌面端打开三项人工确认全过、--strict 导出 2 页原生 0 页占位）。E4 逐条核对 PRD 18 条验收标准全部通过，查出三处 PRD 与实现的口径差异：回到文本复核实际失效 mask 而非 review；分类待确认样本仅 1 个块不足以充分验证；验收后 report 不自动补跑（用户表示这块还想进一步调整，留待后续单独讨论）。E5 把 ROADMAP 的 M4 标为已完成，补齐已交付五项与技术结论四条（含 V2「不改 core/cli」约束被 D8 显式解除、放弃 maskParams 调参路线、界面正反馈必须以磁盘状态为准），列出三条已知缺口。E6 沉淀 spec 三处：backend/contracts.md 新增双人工点闸门与瞬态阶段失效场景，guides/silent-failure-thinking-guide.md 新增「界面有反馈但反馈是假的」一类，frontend/state-management.md 新增会话层盖住耐久层条目。验证 397 例全绿，本次无代码改动。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `bf8fb00` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: 阶段 E 真机走查：AC1–AC17 全通过，另修三条会话层/文案缺陷

**Date**: 2026-07-29
**Task**: 阶段 E 真机走查：AC1–AC17 全通过，另修三条会话层/文案缺陷
**Branch**: `main`

### Summary

用 CDP 驱动真实 Electron 走完 07-28-review-ux-convergence 的阶段 E：REMOTE_DEBUGGING_PORT=9222 起 dev，Runtime.evaluate 读 DOM/store、Input.dispatch* 派发真实鼠标键盘。两处偏离纯手点——原生目录选择框 CDP 够不到且 window.api 被 contextBridge 冻结无法打桩，改调 deck-store.openDeck；界面没有取消已复核入口，未复核夹具直接改 text-blocks.json（走查后已还原）。AC1-AC17 全部通过，含造 clean 失败验 AC3、chmod 555 report 目录验 AC6、page-02 的 clean-001/003失败/004 三 attempt 验 AC16。走查暴露三条缺陷并当场修掉：stage-start/stage-complete 不成对（失败与人工门两条路径）导致会话层永远停在 running 压住耐久层，改为 page-done 时撤掉该页所有仍 running 的阶段；控制台卡片与待办队列把 stale 报成执行失败且各自指错阶段，新增 blockingStageView 让两处同源、stale 措辞统一为上游已变更。core 76 / desktop 255 / cli 93 全绿。通用教训进 spec/frontend/state-management.md。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `c2fca5d` | (see git log) |
| `593ab65` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 复核与验收链路三处缺陷

**Date**: 2026-07-30
**Task**: 复核与验收链路三处缺陷
**Branch**: `main`

### Summary

修掉 07-30 真机暴露的三处「想做的事做不了」。R1：agreed 档只渲染只读段落，双源同错（己/已、专有名词）的块无法修正，错字静默进最终 PPTX——改为点击文本转编辑，textarea 与切行逻辑抽成 BlockTextEditor 与 text-pending 档共用；正文沿用可点非交互元素而非 button，否则 Enter 被放行、键盘流断掉。R2：awaitingFinalConfirm 兼职「待办」与「页面可达」两件事，验收一写入确认页连同页内「重做底图」一起消失，界面上再无重做入口——拆成原子判据 pptxReady/finalAccepted 合成，闸门带 accepted，已验收页呈现已验收状态并保留重做类动作，自动切档改用待办判据。R3：CheckSummary 占右栏 68% 把操作推出视口 1083px——全过折叠、有失败默认展开，操作区底部 sticky，内容高 2089px→762px。四关全绿 465 例（+6）；CDP 1280×800 真机逐条验完 AC1–AC10，零付费接口调用。教训入 spec：state-management「一个判据兼职两件事」、silent-failure 预防清单补「只读展示是隐含断言，启发式给出的断言必须留人工推翻入口」。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `0654798` | (see git log) |
| `cabbcde` | (see git log) |
| `6238ece` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: 桌面端设计语言重构 · 阶段一（令牌 + 组件基座 + 控制台页）

**Date**: 2026-07-31
**Task**: 桌面端设计语言重构 · 阶段一（令牌 + 组件基座 + 控制台页）
**Branch**: `design/desktop-language-rebuild`

### Summary

把 apps/desktop 渲染层从扒自 Airtable 营销站的令牌重做为「校样台」设计语言。根因是 register 错配：营销站设计即产品，本项目是工具型 product register。实测缺陷 hover 0 次、focus-visible 0 次、shadow 0 次、prefers-reduced-motion 0 次，139 处字号声明里 128 处同为 14px（等于无层次），按钮定义在 4 个文件各抄一份且已漂移。核心决策「有颜色 = 要你管」：完成是常态（20–50 页里绝大多数已完成），用饱和色标注常态等于把最强视觉手段给最不需注意的信息，故完成/待执行归中性，饱和色只留给 running/stale/failed；五态另配独立形状（实心圆/空心圆/三角/方块）保证灰度与色弱可分辨。控制台密度一屏 2–3 张提到 15 张，新增「待处理」筛选并复用 deriveTodoQueue 不另写判据，切换常驻可见以免「打开已完成页复看」的能力消失（spec 记录的判据兼职失败模式）。311 测试全绿、对比度 26 项全过；真机实测 AC8/AC9/AC10/AC11 通过，零 gpt-image-2 调用。阶段二（复核页 + 最终确认页）未开始，PRD AC12 用户验收门尚未放行。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `642698f` | (see git log) |
| `2ff2920` | (see git log) |
| `f93bf08` | (see git log) |
| `dc95f8d` | (see git log) |
| `1cfbb72` | (see git log) |
| `8e56216` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: 桌面端设计语言重构 · 阶段三四（键盘陷阱修复 + 基座收口）与环境迁移补齐

**Date**: 2026-07-31
**Task**: 桌面端设计语言重构 · 阶段三四（键盘陷阱修复 + 基座收口）与环境迁移补齐
**Branch**: `main`

### Summary

换机器后补齐环境（重建被清理的 NODE_OPTIONS 预加载脚本、先 build core 才能 typecheck、从既有 deck 复制出两个零云调用的走查工作区），随后按用户裁定完成两处待定：块列表键盘陷阱改为「先动再决定拦不拦」，出口只开给 Tab；分段字号保持 12px。再清空「未做、留给后续的四条」——三处基座重复、radiogroup 语义、MenuItem、z-index 语义刻度，外加 Esc 出口。分段控件是最大一处：只换 role 比不换更糟，因为该模式承诺了组内箭头键导航，所以 roving tabIndex 与键盘导航一并补齐。单测 323 → 346，四关全绿，真机走查四个可复跑脚本全通过。

### Main Changes

### Main Changes

**环境迁移补齐**（仓库从 `/Users/kelin/Work/ppt-maker` 迁到 `/Users/kelin/Workspace/ppt-maker`）

- `NODE_OPTIONS` 指向的 `restore-node-options.cjs` 随临时目录被清理，node 完全起不来，已重建。
- `packages/core` 未构建导致 `apps/cli` typecheck 报 9 个 `has no exported member`——解析的是过期 `dist`。这一步不在原交接清单里。
- 走查工作区未随迁，从 `~/test/ppttest-2026-07-25`（两页流水线全 completed）复制出 `ppttest-walkthrough-E3` 与 `ppttest-switch-target`，零云调用。
- `CLAUDE.md` / `AGENTS.md` 里指向旧路径的文档链接改为相对路径。
- 调试端口正确变量是 `REMOTE_DEBUGGING_PORT`（electron-vite 原生支持），`ELECTRON_ARGS` 无效。

**键盘陷阱修复**（`dc18b1a`，WCAG 2.1.2 A 级，溯源 M4 `9d736ca`）

- 改为「先动再决定拦不拦」：`move` 加 `escapeAtEdge`（Tab true、↑↓ false），派发层按 `moveBy` 是否真移动决定 `preventDefault`。出口只开给 Tab——箭头键抢的是 textarea 内光标移动，放行会让光标乱跳，且它本就带不出焦点。
- 索引计算抽成纯函数 `resolveMoveTargetId`，边界返回 `null`，使「撞到头」可测。
- 补 `⌘/` 开关快捷键面板。`?` 在可编辑区不拦截是对的，但它让「求助」在块列表常驻 textarea 里只剩鼠标，等于陷阱内无键盘自救手段。

**基座收口**（`ef5842e`，清空「未做、留给后续的四条」+ Esc 出口）

- `SECTION_LABEL` 收进 `variants.ts`（排版档非组件，故收成常量）。
- 新增 `NoticeBar` 只收外壳——两处通知条内容结构差别很大，硬合成会得到一堆互斥可选 props；真正要单源的是 level → 底色，取自 `STATUS_SPEC[level].wash`。
- `Panel` 加 `as`：层级是视觉属性，写死 `div` 逼调用点绕开基座手拼。
- 分段控件换 `role="radiogroup"` + `aria-checked`，**并连键盘行为一起换**——只改 role 等于承诺了不兑现，比诚实的 `aria-pressed` 更误导。补 roving tabIndex + 箭头/Home/End 导航 + 无选中态兜底。
- `SegmentedItem` 改直接渲染 `button` + `buttonVariants`：给 `Button` 加「不要输出 aria-pressed」的开关会把特殊情况渗进通用按钮。
- 新增 `MenuItem` 基座（菜单项不是 Button 的一档，形状语言不同）。
- z-index 收成 `sticky`/`popover`/`overlay` 三档语义刻度。
- Esc 判为 `exit-editor`：交还焦点给项外壳，不是退出编辑态——「文字待确认」档没有只读态可退，此前该档 Esc 什么也不做。

### Testing

- 四关全绿：typecheck ✓ / **515 测试**（323 → 346 桌面端，+23）✓ / `pnpm format:check` ✓ / 对比度 26 项 ✓
- 真机走查，脚本均可复跑：
  - `research/after-keyboard-trap/`：`trap-check` 三场景通过（末项 Tab 第 1 次即出、首项 ⇧Tab 第 2 次出、textarea 内 ⌘/ 唤起面板）；`nav-intact` 证明中间仍逐项推进 block-001→006。
  - `research/after-base-cleanup/`：`segmented-a11y` 10/10；`esc-exit` 5/5；另测真实鼠标点击确认键盘改造未伤鼠标路径。

### 沉淀

`.trellis/spec/frontend/quality-guidelines.md` 新增四条禁止项与三条测试要求：Tab 改列表导航时无条件 preventDefault、只换 ARIA role 不兑现键盘承诺、为摘属性给通用组件加开关、求助入口只有一个会失效的键位；放行类修复必须配反向用例、`biome-ignore` 紧邻报错行、走查脚本自己归零前置状态。

### Status

[OK] **Completed** —— 任务全部验收项与遗留清空，已归档。


### Git Commits

| Hash | Message |
|------|---------|
| `dc18b1a` | (see git log) |
| `ef5842e` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete

---

## 2026-07-31 · M5 页面来源与内容策划（父任务规划）

任务：`.trellis/tasks/07-31-page-sources-and-content-generation`（状态 `planning`，未 start）

### 做了什么

只做规划，**零代码改动**。产出 `prd.md` / `design.md` / `implement.md` 三份，
`implement.jsonl` / `check.jsonl` 各 3 条真实上下文条目，另有 `HANDOFF.md` 供换会话接续。

用户拍板 D1–D7 七条决策，其中 D6 / D7 是规划后段追加：

- D1 矢量 PDF 一律位图化 + 显式探测提示；D2 16:9 维持拒绝但改逐页判定、部分导入
- D3 交互式内容策划独立成新里程碑（ROADMAP 现 M6 顺延 M7），M5 只做生成执行侧
- D4 换源默认清空该页人工复核成果，可显式保留
- D5 子任务切「基座纵切 + 入口收口」四块，②③ 可并行
- D6 `generated` 页必须逐张人工确认才走 `ocr`，`imported` / `extracted` 自动放行
- D7 规格双层 + 只读漂移标注 + 调整说明回写规格条目

### 关键判断

- **`accept-source` 是第三个 `ArtifactAcceptance` 同构实例，不是新链路**。阶段图对三种来源
  完全相同，来源只决定该阶段的初始状态。原设计写死「不新增 slide 阶段」，被 D6 推翻——
  修正后的边界是：验收闸门可以加，处理阶段不可以，后者才是抽象失效的信号。
- **自动放行不得写 `accepted.json`**。状态可以是 completed，但不能伪造人工痕迹，
  否则报告声称「有人确认过」而事实没有，正是 M4 头号风险那类记录与事实相反。
- **规格漂移做成只读派生标志而非阶段状态**。不标注 → 静默分歧；自动失效 → 改个错别字
  就推翻已确认产物。sha 比较还天然处理「改了又改回来」。
- **溯源指纹必须条目级**。原稿写成整份规格文件指纹，会导致改一页让全 deck 看起来都过期。

### 风险

- **RK1（未验证）**：`images.generate` 能否直出 2048×1152 没有实证。`images.edit` 用该尺寸
  走的是 SDK 自由 size 通道，不构成 generate 也支持的证据。子任务 ③ 第一步必须实调，
  失败即回父任务重新决策，不得自行选择裁剪或换 Provider。
- **RK4**：新增 `accept-source` 会让旧 manifest 撞上阶段状态完整性校验
  （`workspace-contracts.ts:249`）直接加载失败，打破 A4 零迁移承诺。
  防线是加载期归一化补齐 + 子任务 ① 的旧 manifest 加载回归测试（准入条件）。

### Status

[PENDING] 规划完成待启动 —— 下一步执行 `implement.md` 阶段一（ROADMAP 对齐五项），
提交后再创建子任务 ①。

---

## 2026-08-03 · M6 子任务① 规格编辑与变更日志底座（完工）

父任务 `08-02-content-planning-workbench` 已 start；子任务① 从 Phase 1 走到提交。
七个实现/复核 agent 并行，主线程只做裁定与验证。

### 交付

- `packages/core/src/planning-contracts.ts` — 记录形状 + `diffContentSpec` / `applyRollbackToSpec`（纯函数、零 `node:` 依赖，渲染进程可 import）
- `apps/cli/src/deck/planning-store.ts` — `planning/spec-history.jsonl` 追加写与读取
- `apps/cli/src/deck/spec-edit.ts` — `applySpecChange`（唯一写入入口）/ `previewSpecChange` / `rollbackSpecChange` + 四个格式化函数
- `apps/cli/src/deck/regenerate-batch.ts` — 批量重生成，逐页复用单页执行体
- CLI 新增 `deck spec-apply` / `spec-history` / `spec-rollback`；`deck regenerate` 增 `--pages` / `--all-drifted`
- 收编 `generate.ts` 与 `regenerate.ts` 两处直写；`writeDeckContentSpec` 生产调用点归零到入口一处
- 测试 **774 → 854**（core 141 / desktop 474 / cli 239）

### 关键判断

- **吞掉异常是纪律，藏住结果不是**。旁路日志写失败不许上抛（否则日志故障变成规格保存故障），
  但写入函数必须如实返回成败。原设计写成 `Promise<void>`，导致 `historyWritten` 只能恒 true，
  那条硬验收用例是**假绿**。改成 `Promise<boolean>` 后语义才闭合。
- **信号产生了却没人读，等于没产生**。复核期抓到三处同型缺陷：`historyWritten` 在
  generate/regenerate 路径上只写不读、`missing` 在 `--dry-run` 里预告了却在落盘结果里蒸发、
  `listSpecChangeRecords` 把 `EACCES`/`EISDIR` 伪装成「无记录」。
- **单点用例结构性看不见组合缺陷**。`applyRollbackToSpec` 的 index 升序排序是载荷性的，
  但 10 条既有回滚用例全是单点场景（删一条 / 改一条 / 纯重排），去掉排序竟然全绿。
  反例要「删多条 + 剩下的换位」才构造得出（`[A,B,C,D] → [D,C]`）。
- **判据只允许有一个来源**。`diffContentSpec` 的「改了」判据复用 `specViewFingerprintValues`，
  与过时判据同源；过时判定一律走 `reconcileDeckSpec`。两处各写一份必然漂移，而漂移是静默的。
- **零页 deck 本来就是安全的**。S6 原写成「修边界」，调研后降级为「验证 + 补回归」——
  `deck run` / `status` 全是空循环 + 长度判断，无下标直取无除法，没查出缺陷，只留测试锁定。

### 验证方式上的收获

**变异验证比"我检查过了"有说服力得多**，本轮用了三次都抓到东西：
把批量选页改成"选全部"（A①-2 断言真的红）、拆掉 jsonl 串行队列（暴露"行数正好 20"
根本不构成串行证据，改断言严格顺序）、去掉回滚排序（暴露上面那个空洞）。
凡是"零副作用""字节不变"这类断言，都要先让它红一次再信它。

### 真实工作区走查（A①-1/2/3/4/7）

- 旧格式 deck `~/test/ppttest-2026-07-25`：68 个文件递归哈希四次比对全等，未产生 `planning/`
- `rm -rf planning/` 后 `deck status` 输出与删除前 `diff` 为空；`export` 正常；再写一次目录重建
- 混合来源 deck：`imported`/`extracted` 页没有 `specEntryId`，任何规格扰动都进不了 `--all-drifted`
- 花钱那步只跑 1 页：`reference_text` 换新 sha、`specEntrySha256` 更新、`accept-source` 转
  `stale` 并把旧验收归档、A①-2 在真实 deck 上复验（改动只落在 page-04 与 deck 级三文件）
- `requestId` 三代全为 `null` 且同记录内 usage/耗时真实——网关不回传，不是空壳，未伪造

### 遗留与交接

- `applySpecChange` 每次调用都做全 deck 对账。子任务② 不得做击键级保存；且任一页 manifest
  损坏会让**改任何一条规格文字**都存不下去而界面无从解释——已写入 ② 的 `prd.md` 作硬约束。
- 不带 `--note` 的 `deck regenerate` 仍会记一条「受影响 0 条」的记录（记的是重生成事件本身）。
  界面要不要区分零变更记录，留给 ②。
- `status.ts:224` 有 M5 遗留的第二处指纹比对，本轮未碰。若将来要收敛，是它。

### Status

[DONE] 子任务① 完工并提交。下一步：子任务② `08-02-planning-view` 走 Phase 1。
