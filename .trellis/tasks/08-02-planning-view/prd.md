# planning 视图：规格可见可编辑（M6 子任务②）

## Goal

在桌面端新增独立视图 `planning`（D3），让内容规格**看得见、逐字段改得动**——
补上 M5 留下的缺口：今天唯一能改规格的地方是源图确认页的说明框，只能追加
`revisionNotes`，看不见已累积条目也无法删除，其余全靠手改 JSON。

本轮交付两条完整路径：**从零手工建出一份规格**（建空 deck → 编辑 → 能 `deck run`）
与**打开已有 deck 改规格**。**不做对话**（归子任务③）。

## 边界引用（父任务独占，本任务不得自行修改）

改动以下四项须**回父任务改**：

1. 规格写入统一入口与变更日志的落盘时机 — 父任务 `design.md` §2、§3
2. `SpecChangeRecord` 与 `PlanningMessage` 的记录形状 — 父任务 `design.md` §3.2、§5
3. `SpecProposalSchema` 的提案形状与「提案 ≠ 变更」的落盘流程 — 父任务 `design.md` §4
4. D5 对 D7 的放宽口径 — 父任务 `design.md` §6

界面侧的三条硬约束：

- **写盘只走子任务① 的 `applySpecChange`**，渲染进程不得另起写入路径。
- **只管 ②deck 风格 / ③条目 / ④调整说明**。①引导语、⑤铁律、调用参数按 D8 **不开放**
  （理由见 `ROADMAP.md`「出图依据的组成与可调性」：开放即撞死结——不进指纹则静默过时，
  进指纹则须扩契约，与 D2 冲突）。
- **视觉设计遵从 [DESIGN.md](../../../DESIGN.md)**，实现前先读。六态是硬性要求。

## Phase 1 决策

| # | 主题 | 决策 | 依据 |
|---|---|---|---|
| E1 | ② 的纵深 | **包含「从零手工建规格」完整路径**：建空 deck → 空规格 → 手工敲 `style` 与条目 → 能 `deck run`。V1 的两个入口本轮都交付 | ② 自身即构成可独立验收的闭环（全程不碰 JSON，从零到 `--strict` PPTX）；V5「零页 deck 如实显示」在 ② 内才有真实触发场景；③ 得以专注对话本身。CLI 侧 `createEmptyDeckWorkspace`（`apps/cli/src/deck/workspace.ts:210`）已就绪且被 `deck generate` / `extract` 用着，只差 IPC 与界面 |
| E2 | 保存时机 | **显式保存按钮**：编辑器维护脏标记，点「保存」才调 `applySpecChange`。必须做离开未保存时的拦截 | 一次编辑会话 = 一条 `SpecChangeRecord`，正好对上记录的 `summary`（一句话人可读描述），回滚粒度是「刚才那次改动」而非碎片。失焦即存会把改一页标题拆成 3–5 条几乎相同的记录，且每次失焦都触发全 deck 对账（11 页读 22 个 JSON）；防抖的记录边界由打字节奏而非语义决定，不可预测 |
| E3 | A5 的界面归属 | **② 做最小历史面板**：记录列表 + 逐条 diff + 回滚。补上子任务地图里三方都没认领的缺口 | `historyWritten === false` 的提示需要一个真实落点，否则等于指向界面上不存在的地方；`diffContentSpec` 是 core 纯函数、渲染进程可直接 import；回滚只需包一个 `rollbackSpecChange` 的 IPC。历史是规格的属性，它的家在规格视图旁边，不在对话面板里 |
| E4 | 走查边界 | **离线用例覆盖全部批量分支**（可注入 stub generator）**+ 真机只跑 1 页真实调用** | A4「未勾选页字节不变」是文件系统事实，与图像内容无关，stub 验得同样严格；真实调用只需证明批量路径确实接到了 `replace-source.ts:70` 的 `referenceText` 通道。改 style 跑 4 页花销翻倍却换不到额外信息 |
| E5 | 布局骨架 | **左栏本轮放历史面板**，③ 接入时在左栏顶部加「对话 / 历史」分段切换，不改布局骨架 | DESIGN.md 明令「空态不得占用固定版面」（上一版待办队列空态占 27% 宽度是被点名的错误）；历史流与对话流信息形态同构，共用左栏是自然的，也让 ③ 零返工 |

## Requirements

- **V1 新视图**：`AppView` 第四项 `planning`（`apps/desktop/src/renderer/stores/ui-store.ts:11`），
  两个入口——从空态新建策划、从已打开 deck 改规格。布局左历史区右规格区（E5）。
  M5 ④ 新增 `source-review` 是同类先例，照它的形状接。
- **V2 条目列表与逐字段编辑器**：`style.description`（大文本框）、`pageType`、
  `textGroups`（分组与条目**增删改**）、`visualIntent`、`revisionNotes`（**可见且可删除**）。
  `style` 不拆结构化控件（D2），下游吃的就是散文。
- **V3 改文字的分量要如实呈现**：`textGroups` 有双重身份，既进提示词又经
  `flattenSpecEntryTexts` 展平为该页 `reference_text`（下游 OCR 复核的文字真值基准）。
  界面上不能设计得像改提示词那样轻。
- **V4 已过时页清单与勾选确认**（D9）：列出**全部**已过时页，默认全选、可逐页取消，
  一次付费确认后批量重生成。改 `style` 的爆炸半径是 deck 级，清单必须列全。
- **V5 零页 deck 的显示**（父任务 R8）：控制台对「有规格、零页」的 deck 如实显示不报错。
- **V6 旧格式 deck 可打开**：无 `source` 字段的 M3/M4 时代 deck 打开工作台不报错、不被改写。
- **V7 变更历史与回滚界面**（E3，补父任务 A5 的界面缺口）：记录列表 + 逐条 diff + 回滚，
  回滚文案须写明「回滚是一次新的前进，不抹历史」。
- **V8 新建空 deck**（E1）：选父目录 + 填 deck 名建出空 deck 并切工作区，
  随后可在空规格上从零编辑。

## Acceptance Criteria

- [ ] 全程不碰 JSON 即可完成 `content-spec.json` 的所有编辑，含 `revisionNotes` 的删除（父任务 A3）
- [ ] **从零**建空 deck → 手工写规格 → 生成 → 能 `deck run` 到 `--strict` PPTX（E1；父任务 A1 的非对话半条）
- [ ] 改 `style` 后所有生成页报漂移且清单**列全**；勾选后批量重生成，
      **未勾选的页字节不变**（父任务 A4 硬验收，须变异验证过）
- [ ] 任何会发起图像生成的动作，事前确认都写明**调用次数与不可撤销**（父任务 A8）
- [ ] 变更历史可在界面回看、可回滚；`historyWritten === false` 时界面**出声**且指向历史面板（E3）
- [ ] 旧格式 deck（`~/test/ppttest-2026-07-25`）打开工作台不报错、不被改写（父任务 A6）
- [ ] 混合来源 deck（`~/test/wt4-append`）里非 `generated` 页完全不参与规格对账
      （`collectGeneratedPages` 只认 `generated` 是 M5 A2 的既有保证，不得破坏）
- [ ] 测试基线不低于 **854**（core 141 / desktop 474 / cli 239），新增能力有对应用例（父任务 A9）

> 父任务 prd 的 A9 写的是旧基线 774，子任务① 完工后实测为 854，以此为准。

## 子任务① 已落地，可直接用的东西

① 已完工（提交 `51a1823`）。本任务的编辑器字段直接对着 ① 的写入入口，
**不要自造临时写盘路径**。

| 符号 | 位置 | 用途 |
|---|---|---|
| `applySpecChange` | `apps/cli/src/deck/spec-edit.ts:269` | 唯一写入口，返回 `historyWritten` / `drifted` / `missing` |
| `previewSpecChange` | 同上 `:334` | 不写盘的过时预告（本轮不接，理由见 design §4.3） |
| `rollbackSpecChange` | 同上 `:377` | 回滚，追加新记录，不抹历史 |
| `formatSpecHistoryWarning` | 同上 `:470` | `historyWritten=false` 的文案参考，两处措辞须一致 |
| `listSpecChangeRecords` | `apps/cli/src/deck/planning-store.ts:88` | 读历史，坏行跳过 |
| `diffContentSpec` | `packages/core/src/planning-contracts.ts:187` | 纯函数、零 `node:` 依赖，渲染进程可直接 import |
| `runDeckRegenerateBatch` | `apps/cli/src/deck/regenerate-batch.ts:227` | 批量重生成，`generate` 可注入 stub |

**两条硬交接约束**（解法见本任务 `design.md` §7.1 与 §4）：

1. **不要做击键级保存**——`applySpecChange` 每次调用都同步做一遍全 deck 对账
   （`loadDeckWorkspace` + `collectGeneratedPages`），11 页 deck 上一次保存要读 22 个 JSON。
   已由 E2 的显式保存解决。
2. **一页坏，全盘存不下**——任一页 slide manifest 损坏会让改**任何一条**规格文字的保存失败，
   而界面无从解释。解法是 main 侧只在失败路径上复用 `buildDeckStatusDetailed` 补齐坏页上下文，
   **不给 `applySpecChange` 加跳过对账的开关**（那会连 `drifted` 一起丢掉）。

## 依赖

**子任务① `08-02-spec-edit-and-history`**（已完工）。

## Notes

- 真实素材（一律 `cp -R` 到 scratchpad 副本上操作，事后用递归哈希验证原件未变）：
  - `~/test/wt4-spec-2026-08-02`：4 页全 `generated`，**page-04 基线即 drifted**——
    批量走查前必须先 `deck status --json` 确认集合，否则会多跑一页、多花一份钱。
  - `~/test/wt4-append`：11 页混合来源（imported 4 / extracted 6 / generated 1），
    只有 page-11 有 `specEntryId`。
  - `~/test/ppttest-2026-07-25`：2 页 imported 的旧格式基线，无 `content-spec.json`。
- 真机走查复用归档工具
  `.trellis/tasks/archive/2026-08/07-31-page-sources-and-content-generation/tools/`
  （`cdp.mjs` / `main-cdp.mjs` / `patch-dialog.js` / `restart.sh` / `snap.sh`，
  `tools/README.md` 说明了原生对话框为何必须打桩）。
- 本仓**没有 `lint` 脚本**，代码风格检查是 `pnpm format:check`（biome）。
  `pnpm typecheck` 之前必须先 `pnpm --filter @ppt-maker/core build`。
