# planning 视图：规格可见可编辑（M6 子任务②）

> 本文由父任务 `08-02-content-planning-workbench` 在阶段一播种，只写**目标与边界**。
> Requirements / Acceptance 是父任务下发的种子，子任务自行走 Phase 1 细化，
> 并按需补 `design.md` / `implement.md` 后再 `task.py start`。

## Goal

在桌面端新增独立视图 `planning`（D3），让内容规格**看得见、逐字段改得动**——
补上 M5 留下的缺口：今天唯一能改规格的地方是源图确认页的说明框，只能追加
`revisionNotes`，看不见已累积条目也无法删除，其余全靠手改 JSON。

**本任务不做对话**（归子任务③），只做规格的呈现与编辑，以及已过时页的清单与勾选确认。

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
- **视觉设计遵从 [DESIGN.md](../../../DESIGN.md)**，实现前先读。

## Requirements（父任务下发的种子，子任务 Phase 1 细化）

- **V1 新视图**：`AppView` 第四项 `planning`（`ui-store.ts:11`），两个入口——
  从空态新建策划、从已打开 deck 改规格。布局左对话区（本任务先留位）右规格区。
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

## Acceptance Criteria（种子）

- [ ] 全程不碰 JSON 即可完成 `content-spec.json` 的所有编辑，含 `revisionNotes` 的删除（父任务 A3）
- [ ] 改 `style` 后所有生成页报漂移且清单**列全**；勾选后批量重生成，
      **未勾选的页字节不变**（父任务 A4 硬验收）
- [ ] 任何会发起图像生成的动作，事前确认都写明**调用次数与不可撤销**（父任务 A8）
- [ ] 旧格式 deck（`~/test/ppttest-2026-07-25`）打开工作台不报错、不被改写（父任务 A6）
- [ ] 混合来源 deck（`~/test/wt4-append`）里非 `generated` 页完全不参与规格对账
      （`collectGeneratedPages` 只认 `generated` 是 M5 A2 的既有保证，不得破坏）
- [ ] 测试基线不低于 774，新增能力有对应用例（父任务 A9）

## 依赖

**子任务① `08-02-spec-edit-and-history`**。本任务的编辑器字段直接对着 ① 的写入入口，
① 未落地前不要自造临时写盘路径。

## Notes

- 真实素材：`~/test/wt4-spec-2026-08-02`（M6 直接输入）、`~/test/wt4-append`（11 页混合）、
  `~/test/ppttest-2026-07-25`（旧格式）。
- 真机走查复用归档工具
  `.trellis/tasks/archive/2026-08/07-31-page-sources-and-content-generation/tools/`
  （`cdp.mjs` / `main-cdp.mjs` / `patch-dialog.js` / `restart.sh` / `snap.sh`，
  `tools/README.md` 说明了原生对话框为何必须打桩）。
