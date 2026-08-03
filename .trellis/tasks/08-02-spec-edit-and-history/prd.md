# 规格编辑与变更日志底座（M6 子任务①）

> 本文由父任务 `08-02-content-planning-workbench` 在阶段一播种，只写**目标与边界**。
> Requirements / Acceptance 是父任务下发的种子，子任务自行走 Phase 1 细化，
> 并按需补 `design.md` / `implement.md` 后再 `task.py start`。

## Goal

在 core/CLI 侧建起 M6 的写入底座：`content-spec.json` 的**唯一写入入口**、
追加式变更日志的读写与回滚、已过时页的批量重生成命令、零页 deck 的边界修补。

这是 M6 的地基——子任务② 的编辑器字段直接对着本任务的写入入口，
子任务③ 的提案落盘复用同一个入口。**本任务不做任何界面。**

## 边界引用（父任务独占，本任务不得自行修改）

改动以下四项须**回父任务改**，不在本任务里微调
（M5 的教训是「来源契约由父任务独占」，否则混合场景要到最后集成才炸）：

1. 规格写入统一入口与变更日志的落盘时机 — 父任务 `design.md` §2、§3
2. `SpecChangeRecord` 与 `PlanningMessage` 的记录形状 — 父任务 `design.md` §3.2、§5
3. `SpecProposalSchema` 的提案形状与「提案 ≠ 变更」的落盘流程 — 父任务 `design.md` §4
4. D5 对 D7 的放宽口径 — 父任务 `design.md` §6，已收录于
   `.trellis/spec/backend/contracts.md`〈模型可提案、不可直接落盘〉

另有两条硬约束来自父任务 PRD：

- **契约一字不改**：`ContentSpecSchema` / `specViewFingerprintValues` /
  `buildPageGenerationPrompt` / `SCHEMA_VERSION` 全部保持不变（父任务 A7）。
  `content-spec.json` **没有**独立版本轴，`planning/` 下的新文件自带局部 `v: 1`
  （见 `.trellis/spec/backend/contracts.md`〈独立可寻址契约文件的版本轴〉）。
- **旁路纪律**：`planning/` 整个目录可删，删后只失去回看与回滚能力；
  CLI 的任何正确性路径（`deck run` / `generate` / `status` / `export`）**不得读** `planning/`。

## Requirements（父任务下发的种子，子任务 Phase 1 细化）

- **S1 统一写入入口**：新增 `applySpecChange`，职责不可拆的一组是
  校验 → 算新旧指纹 → 更新 `updatedAt` → 原子写 → 追加变更记录。
  禁止任何调用方绕过它直接调 `writeDeckContentSpec`。
  第 5 步失败**不回滚**前四步，只记 stderr。
- **S2 变更日志读写**：`planning/spec-history.jsonl` 追加写，读取时坏行跳过
  （照搬 `apps/desktop/src/main/activity-log.ts:list`）。
- **S3 回滚**：把目标记录的 `styleBefore` / `entriesBefore` 重新写入当前规格，
  并**追加**一条 `origin: "rollback"` 的新记录。**不抹历史**。
- **S4 批量重生成命令**：逐页复用单页 `deck regenerate` 的语义，
  尤其是 `apps/cli/src/slide/replace-source.ts:70` 的 `referenceText` 通道
  （改了规格文字的页必须写**新的** `reference_text` 资产并把新 sha 计入指纹）。
  与单页的差别只在三处：一次确认覆盖 N 页、进度按页汇报、
  单页失败不终止其余页（沿用 `deck generate` 的「一页都没成才算失败」口径）。
- **S5 `revisionNotes` 可删**：schema 不加限制，删除动作走 S1 的同一入口，因此同样记日志。
- **S6 零页 deck 边界**（父任务 R8）：`deck run` / `deck status` 对「有规格、零页」的 deck
  如实显示且不报错。

## Acceptance Criteria（种子）

- [ ] CLI 层跑通「改条目 → 落盘 → 记日志 → 回滚 → 批量重生成」全链路
- [ ] **未勾选的页在批量重生成后字节不变**（父任务 A4 的硬验收，做不到就回滚到 D9 次选）
- [ ] `rm -rf <deck>/planning/` 后所有主链路功能照常（父任务 A5）
- [ ] 旧格式 deck（`~/test/ppttest-2026-07-25`，无 `source` 字段）读写不报错、不被改写（父任务 A6）
- [ ] `git diff` 确认生成侧契约的 schema 定义与函数体逐字未变（父任务 A7）
- [ ] 测试基线不低于 774（core 111 / desktop 474 / cli 189），新增能力有对应用例（父任务 A9）
- [ ] 变更日志里模型调用的 `requestId` 为 `null` 时如实记 `null`，不伪造

## 依赖

无。本任务是 ② ③ 的前置。

## Notes

- 真实素材：`~/test/wt4-spec-2026-08-02`（M6 直接输入）、`~/test/wt4-append`（11 页混合来源）、
  `~/test/ppttest-2026-07-25`（旧格式）。用真实工作区验收，不用 fixture。
- 风险 RK-M6-1：零页 deck 若撞到既有未覆盖分支，在本任务修边界，
  **不要**绕过 D4 改成「内存态草稿」——那会引回第二套存储。
