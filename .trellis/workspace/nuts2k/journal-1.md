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
