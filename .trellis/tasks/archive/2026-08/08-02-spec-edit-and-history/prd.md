# 规格编辑与变更日志底座（M6 子任务①）

> 父任务 `08-02-content-planning-workbench` 播种了目标与边界，本文是子任务自行细化后的版本。
> 九条决策 D1–D9 与父任务四条契约**已定，不重新论证**，见父任务 `prd.md` / `design.md`。

## Goal

在 core/CLI 侧建起 M6 的写入底座：`content-spec.json` 的**唯一写入入口**、
追加式变更日志的读写与回滚、已过时页的批量重生成命令、零页 deck 的边界确认。

这是 M6 的地基——子任务② 的编辑器字段直接对着本任务的写入入口，
子任务③ 的提案落盘复用同一个入口。**本任务不做任何界面。**

## 边界引用（父任务独占，本任务不得自行修改）

改动以下四项须**回父任务改**，不在本任务里微调：

1. 规格写入统一入口与变更日志的落盘时机 — 父任务 `design.md` §2、§3
2. `SpecChangeRecord` 与 `PlanningMessage` 的记录形状 — 父任务 `design.md` §3.2、§5
3. `SpecProposalSchema` 的提案形状与「提案 ≠ 变更」的落盘流程 — 父任务 `design.md` §4
4. D5 对 D7 的放宽口径 — 父任务 `design.md` §6，已收录于
   `.trellis/spec/backend/contracts.md`〈模型可提案、不可直接落盘〉

两条硬约束来自父任务 PRD：

- **契约一字不改**：`ContentSpecSchema` / `specViewFingerprintValues` /
  `buildPageGenerationPrompt` / `SCHEMA_VERSION` 全部保持不变（父任务 A7）。
  `content-spec.json` **没有**独立版本轴，`planning/` 下的新文件自带局部 `v: 1`。
- **旁路纪律**：`planning/` 整个目录可删，删后只失去回看与回滚能力；
  CLI 的任何正确性路径（`deck run` / `generate` / `status` / `export`）**不得读** `planning/`。

## 本轮调研确认的既有事实（细化依据）

这些是 Phase 1 调研查证的现状，后续设计以此为准，实现时若与代码不符须先回本节订正：

- `specViewFingerprint` **不在 core**，在 `apps/cli/src/providers/page-generation.ts:21`；
  core 只有字段投影 `specViewFingerprintValues`（`packages/core/src/content-spec-contracts.ts:152`）。
  原因是 core 被渲染进程直接 import，不能拉 `node:crypto`（同文件 135–138 行注释）。
  → 统一写入入口只能落在 CLI 侧，core 只放类型与纯函数。
- 全仓**写 deck 内 `content-spec.json` 的生产调用点只有两处**：
  `apps/cli/src/deck/generate.ts:208`（`--spec` 导入外部规格）与
  `apps/cli/src/deck/regenerate.ts:178`（`appendRevisionNote` 追加说明后写回）。
  桌面端两处 `spec-draft` 落的是临时目录，不进 deck，不在收编范围。
  → S1 的收编面是确定的两处，不是未知规模。
- `writeJsonAtomic` 在 `apps/cli/src/slide/workspace.ts:120`（临时文件 + `rename`），已被
  `deck/content-spec.ts` 等多处跨目录复用；`writeDeckContentSpec`
  （`apps/cli/src/deck/content-spec.ts:67`）内部已 `parse` + 原子写。
- `deck run` / `deck status` 在零页 deck 上**结构性安全**：两者都是 `for...of` 空循环 +
  长度判断，无下标直取、无除法（`apps/cli/src/deck/run.ts:36`、`apps/cli/src/deck/status.ts:188`、
  `status.ts:274`、`status.ts:386`、`status.ts:448`）。
  → S6 的实际形态是**验证 + 补回归测试**，只有查出缺陷才改代码（见 RK-1）。
- 旧格式 deck（无 `source`）由 `normalizeSlideManifest`（`packages/core/src/manifest-normalize.ts:82`）
  在内存中补齐，**明确不落盘**（`apps/cli/src/slide/workspace.ts:420` 注释）。
  → A6 的「不被改写」在只读路径上已由既有纪律保证，本任务不得破坏它。
- 测试：三包统一 vitest，`test/*.test.ts` 平铺；CLI 的集成测试是**直接调 `src/` 导出函数
  在 `mkdtemp` 真实工作区上跑**，没有 spawn 二进制的先例（`apps/cli/test/deck-status.test.ts:27`）。
  → 本任务的验收测试沿用这一层级，不新引入子进程测试方式。

## 本任务自行敲定的四条（child-level，不动父任务契约）

| 编号 | 决策 | 理由 |
|---|---|---|
| C1 | CLI 编辑入口是**整份规格替换**：`deck spec-apply --file <spec.json>`，差异由代码算 | 与 D5「模型输出全量条目 → diff」同构，一条入口同时服务人工编辑与提案落盘；细粒度字段选项会长出第二套语义 |
| C2 | 批量重生成**复用 `deck regenerate` 命令**，新增互斥选项 `--pages <labels...>` / `--all-drifted`，`--page` 单页语义不变 | 父任务 design §7 要求复用单页语义；另起命令会让两条路径各自演化 |
| C3 | `generate.ts:208` 的首次导入也走统一入口，记 `origin: "manual"`，`entriesBefore` 为空 | 「首次写入」就是 before 为 null 的新增，不需要给 origin 枚举加值（加值属于父任务契约） |
| C4 | `applySpecChange` 强制沿用磁盘上既有的 `specId` / `createdAt`，忽略入参里的这两项 | D7 保护条 2：id 与时间戳始终由代码分配，外部文件与模型都不得改写 |

## Requirements

- **S1 统一写入入口**：新增 `applySpecChange`，职责不可拆的一组是
  校验 → 算新旧指纹 → 更新 `updatedAt` → 原子写 → 追加变更记录。
  禁止任何调用方绕过它直接调 `writeDeckContentSpec`；既有两处调用点（`generate.ts:208`、
  `regenerate.ts:178`）本轮收编。第 5 步失败**不回滚**前四步，只记 stderr。
- **S2 变更日志读写**：`planning/spec-history.jsonl` 追加写，读取时坏行跳过、文件不存在返回空
  （照搬 `apps/desktop/src/main/activity-log.ts` 的串行队列 + 只记 stderr + 坏行跳过三件事）。
  **只读路径不得创建 `planning/` 目录**（A6）。
- **S3 回滚**：把目标记录的 `styleBefore` / `entriesBefore` 重新写入当前规格，
  并**追加**一条 `origin: "rollback"`、`rollbackOf` 指向目标记录的新记录。**不抹历史**。
- **S4 批量重生成命令**：逐页复用单页 `deck regenerate` 的语义，尤其是
  `apps/cli/src/slide/replace-source.ts:66` 的 `referencePath` 通道
  （改了规格文字的页必须写**新的** `reference_text` 资产并把新 sha 计入指纹）。
  与单页的差别只在三处：一次确认覆盖 N 页、进度按页汇报、单页失败不终止其余页
  （沿用 `deck generate` 的「一页都没成才算失败」口径，`apps/cli/src/index.ts:654`）。
- **S5 `revisionNotes` 可删**：schema 不加限制，删除动作走 S1 的同一入口，因此同样记日志。
- **S6 零页 deck 边界**：`deck run` / `deck status` 对「有规格、零页」的 deck 如实显示且不报错。
  先以真实零页 deck 验证并补回归测试；查出缺陷才改代码。
- **S7 过时范围预告（细化新增）**：提供 `previewSpecChange`，在**不落盘**的前提下算出
  「若该规格生效，哪几页变为已过时」。父任务 design §4.4 要求确认对话框必须写出这个数字，
  界面在子任务②③，但计算属于 core/CLI 侧，归本任务交付。
- **S8 差异计算下放 core（细化新增）**：`diffContentSpec(before, after)` 为纯函数、无 Node 依赖，
  放 `packages/core`，供渲染进程直接 import 做逐字段 diff 展示；哈希相关部分留在 CLI。

## Acceptance Criteria

- [x] A①-1 CLI 层跑通「改条目 → 落盘 → 记日志 → 回滚 → 批量重生成」全链路，
      在 `~/test/wt4-spec-2026-08-02` 真实 deck 上完成一次
- [x] A①-2 **未勾选的页在批量重生成后字节不变**（父任务 A4 硬验收）：
      以页目录递归内容哈希在批量前后比对，不等即判失败并回滚到 D9 次选（只标注）
- [x] A①-3 `rm -rf <deck>/planning/` 后 `deck run` / `generate` / `status` / `export` 全部照常（父任务 A5）
- [x] A①-4 旧格式 deck（`~/test/ppttest-2026-07-25`，无 `source` 字段）读写不报错、
      **只读命令跑完后 deck 目录内容零变化**（含不产生 `planning/`）（父任务 A6）
- [x] A①-5 `git diff` 确认 `ContentSpecSchema` / `specViewFingerprintValues` /
      `buildPageGenerationPrompt` / `SCHEMA_VERSION` 的定义与函数体逐字未变（父任务 A7）
- [x] A①-6 测试基线不低于 774（core 111 / desktop 474 / cli 189），
      S1–S8 每条都有对应用例；`pnpm format:check` / `typecheck` / `test` / `build` 全绿（父任务 A9）
- [x] A①-7 变更日志里模型调用的 `requestId` 为 `null` 时如实记 `null`，不伪造
- [x] A①-8 收编后全仓再无第二条写 deck 内 `content-spec.json` 的生产路径
      （以 `writeDeckContentSpec` 的调用点全量检索为准，除 `applySpecChange` 自身外为零）
- [x] A①-9 回滚后再回滚（连做两次）语义正确：历史只增不减，规格在两个版本间来回

## 依赖

无。本任务是子任务② ③ 的前置。顺序是硬的：① → ② → ③。

## Notes

- 真实素材：`~/test/wt4-spec-2026-08-02`（M6 直接输入）、`~/test/wt4-append`（11 页混合来源）、
  `~/test/ppttest-2026-07-25`（旧格式）。用真实工作区验收，不用 fixture。
- RK-1（父任务 RK-M6-1）：零页 deck 若撞到既有未覆盖分支，在本任务修边界，
  **不要**绕过 D4 改成「内存态草稿」——那会引回第二套存储。
- RK-2：收编 `regenerate.ts:178` 后，每次 `deck regenerate` 都会产生一条变更记录。
  这是想要的（变更可追溯），但必须确认它不会在**只读**路径上创建 `planning/`。
- RK-3：新增的稳定错误码须在 Phase 3 登记进 `.trellis/spec/backend/error-handling.md`。
