# 执行计划：规格编辑与变更日志底座（M6 子任务①）

> **完工核对（2026-08-04，归档前）**：本任务代码与真实走查在提交 `51a1823` 即已完成，
> 旧流程遗留状态为 `in_progress`。归档前重新核对，无缺口：
>
> - T1–T7 交付物齐全：`packages/core/src/planning-contracts.ts`、
>   `apps/cli/src/deck/planning-store.ts`、`spec-edit.ts`、`regenerate-batch.ts`、
>   `apps/cli/test/deck-zero-page.test.ts`；`index.ts` 三条命令 `spec-apply` / `spec-history` /
>   `spec-rollback` 均已注册。
> - A①-8：`rg writeDeckContentSpec`（排除 test）只剩定义与 `spec-edit.ts` 调用，无第二条写入路径。
> - A①-5：`git diff 51a1823^..HEAD -- content-spec-contracts.ts constants.ts page-generation.ts`
>   为空，M6 全程生成侧契约逐字未变。
> - A①-6：`format:check` / `typecheck` / `test` / `build` 全绿；测试 948 项
>   （core 156 / desktop 527 / CLI 265），远高于本任务基线 774。
> - T9 沉淀已在库：三个错误码登记于 `.trellis/spec/backend/error-handling.md:31-33`，
>   `contracts.md:1071` 已有〈规格写入唯一入口与变更日志〉一节。
> - 本机首次核对时 `apps/cli` typecheck 因 `core/dist` 过期报 40 处假失败，
>   先跑 `pnpm --filter @ppt-maker/core build` 即消失（换机说明已记载此坑）。
>
> 下方 T1–T9 复选框保持提交时的原样，未回填勾选。

顺序是硬的：T1 → T9。每个 T 完成即为一个可独立 revert 的提交点。
T4 是本任务**唯一改动既有行为**的一步，单独成提交，出问题只回滚它。

## 前置确认（开工第一件事，5 分钟）

- [ ] P1 用 `git log --oneline -1` 确认工作区在 `a04926c` 之后且干净
- [ ] P2 复核 `prd.md`〈本轮调研确认的既有事实〉六条与代码一致：
      `apps/cli/src/providers/page-generation.ts:21`、`apps/cli/src/deck/generate.ts:208`、
      `apps/cli/src/deck/regenerate.ts:178`、`apps/cli/src/slide/workspace.ts:120`、
      `apps/cli/src/deck/status.ts:219`、`packages/core/src/manifest-normalize.ts:82`。
      **不一致就先回 prd 订正，再动手**
- [ ] P3 `pnpm test` 取本轮基线数字（期望 core 111 / cli 189 / desktop 474），记进 journal

## T1 core 契约与纯函数

- [ ] 新建 `packages/core/src/planning-contracts.ts`：类型 + `SpecChangeRecordSchema`
      （`v: z.literal(1)`，**不用 `SCHEMA_VERSION`**）+ `diffContentSpec` + `applyRollbackToSpec`
- [ ] `packages/core/src/index.ts` 导出
- [ ] 测试 `packages/core/test/planning-contracts.test.ts`：新增 / 删除 / 修改 / 纯重排四类 diff；
      回滚的三步顺序（删新增 → 按 index 升序插回 → 未触及条目保留）；
      连做两次回滚（A①-9 的纯函数部分）；坏形状被 schema 拒绝
- [ ] 验证：`pnpm --filter @ppt-maker/core test && pnpm --filter @ppt-maker/core typecheck`

**复核点 R1**：core 里没有出现 `node:` 开头的 import（这条一破，渲染进程就加载不了）。

## T2 jsonl 存储

- [ ] 新建 `apps/cli/src/deck/planning-store.ts`：路径常量、按需建目录、
      `appendSpecChangeRecord`（串行队列 + 失败只 `console.error`）、
      `listSpecChangeRecords`（坏行跳过 + 文件不存在返回 `[]` + `reverse().slice(limit)`）
- [ ] 测试 `apps/cli/test/planning-store.test.ts`（`mkdtemp` 真实目录）：
      追加多条后按倒序读回；手工插一行坏 JSON 与一行结构不符的 JSON，两者都被跳过且其余可读；
      文件不存在返回 `[]` **且不创建 `planning/` 目录**；目标目录不可写时 append 不抛
- [ ] 验证：`pnpm --filter @ppt-maker/cli test -- planning-store`

**复核点 R2**：只读路径（`listSpecChangeRecords`）跑完，deck 目录内容零变化。

## T3 统一写入入口与过时预告

- [ ] 新建 `apps/cli/src/deck/spec-edit.ts`：`applySpecChange`（六步，见 design §4）、
      `previewSpecChange`、`rollbackSpecChange`
- [ ] `specId` / `createdAt` 强制沿用磁盘现值（C4）；style 变更时全条目计入受影响集合
- [ ] 测试 `apps/cli/test/spec-edit.test.ts`：
      改一条 → 规格落盘 + 历史一条 + `drifted` 命中该页；
      改 style → 所有条目进 `fingerprints`；
      入参伪造 `specId`/`createdAt` 被忽略；
      历史写失败（把 `planning` 建成同名文件制造失败）时规格照样落盘、`historyWritten: false` 且不抛；
      回滚 → 规格回到前值且历史 +1；再回滚 → 回到后值且历史 +1（A①-9）；
      `previewSpecChange` 不写任何文件（前后目录内容哈希相等）
- [ ] 验证：`pnpm --filter @ppt-maker/cli test -- spec-edit`

**复核点 R3**：`applySpecChange` 第 6 步的任何异常都不会传播出函数。

## T4 收编两处既有写入（唯一行为改动点，单独提交）

- [ ] `apps/cli/src/deck/generate.ts:208` 改走 `applySpecChange`（C3，`origin: "manual"`）
- [ ] `apps/cli/src/deck/regenerate.ts:176` 的 `appendRevisionNote` 写回改走 `applySpecChange`，
      **保持「先写规格再出图」的既有时序**
- [ ] `apps/cli/src/deck/content-spec.ts:67` 的 `writeDeckContentSpec` 上加注释：唯一合法调用方是 `applySpecChange`
- [ ] 全量检索确认收编干净（A①-8）：
      `rg -n "writeDeckContentSpec" apps packages --glob '!**/test/**'` 只剩定义与 `spec-edit.ts`
- [ ] 验证：`pnpm --filter @ppt-maker/cli test`（既有 deck-generate / deck-regenerate 用例必须全绿，
      **一条都不许改断言**——改断言就说明行为变了）

**回滚点 RB1**：本步单独提交。若既有用例出现无法用「日志是新增旁路」解释的失败，
`git revert` 本提交，回到 T3 结束态重新设计收编方式。

## T5 CLI 三条命令

- [ ] `apps/cli/src/index.ts` 注册 `deck spec-apply`（`--file` / `--summary` / `--dry-run`）、
      `deck spec-history`（`--limit` / `--json`）、`deck spec-rollback`（`--record`）
- [ ] 新增错误码 `SPEC_HISTORY_RECORD_NOT_FOUND` / `SPEC_SELECTION_EMPTY` / `SPEC_PAGE_NOT_FOUND`
- [ ] 输出格式：stdout 给结果、stderr 给过程，对齐既有 `format*` 函数写法
- [ ] 测试：直接调用导出函数（沿用 `apps/cli/test/deck-status.test.ts:27` 的层级，不 spawn 子进程）
- [ ] 验证：`pnpm --filter @ppt-maker/cli test && pnpm --filter @ppt-maker/cli typecheck`

## T6 批量重生成（含 A①-2 硬验收）

- [ ] `regenerate.ts` 抽出 `regenerateOnePage`，`runDeckRegenerate` 导出签名不变
- [ ] 新建 `apps/cli/src/deck/regenerate-batch.ts`：选页（`labels` / `all-drifted`）、串行、
      单页失败不终止、进度回调、`formatDeckRegenerateBatchResult`
- [ ] `deck regenerate` 增 `--pages` / `--all-drifted`，与 `--page` 三选一且必选；
      `--spec-entry` 仅与 `--page` 合法；退出码「一页都没成才算失败」
- [ ] **A①-2 测试**：造 3 页 deck，改其中 1 页的规格文字，批量只选该页 →
      对未选中两页的目录做递归内容哈希，批量前后必须逐字节相等
- [ ] 确认批量路径不直接调 `replaceSlideSource`：
      `rg -n "replaceSlideSource" apps/cli/src/deck/regenerate-batch.ts` 应为零命中
- [ ] 验证：`pnpm --filter @ppt-maker/cli test`

**回滚点 RB2**：A①-2 若做不到，按父任务 D9 次选**整体撤回批量入口，只保留「标注已过时」**，
并在 journal 与父任务 `prd.md` 记明原因。不许留一个「大概不会动别的页」的批量按钮。

## T7 零页 deck 边界（S6）

- [ ] 用 `createEmptyDeckWorkspace` 建零页 deck，写入一份规格，跑 `deckStatus` 与 `runDeckPipeline`
- [ ] 新增回归测试 `apps/cli/test/deck-zero-page.test.ts`：两条命令都不抛、
      汇总数字为 0、`formatDeckStatus` 输出「完成: 0/0」不含 `NaN`
- [ ] 查出真缺陷才改代码；未查出则在 journal 记「S6 经验证无需改代码」并保留测试

## T8 真实工作区走查

- [ ] W1 `~/test/wt4-spec-2026-08-02`：`spec-apply --dry-run` → `spec-apply` → `spec-history` →
      `spec-rollback` → `regenerate --all-drifted --confirm-upload` 全链路（A①-1）
- [ ] W2 `~/test/wt4-append`（11 页混合来源）：`--all-drifted` 只选中该选的页；
      `imported` / `extracted` 来源的页不被批量误选
- [ ] W3 `~/test/ppttest-2026-07-25`（旧格式）：先做目录内容哈希快照，跑
      `deck status` / `deck spec-history` 等只读命令后再快照，**必须相等**且未产生 `planning/`（A①-4）
- [ ] W4 `rm -rf <deck>/planning/` 后 `deck run` / `generate` / `status` / `export` 全部照常（A①-3）
- [ ] W5 变更记录里模型调用相关字段：`requestId` 为 null 时如实记 null（A①-7）
- [ ] 走查结论写入 `.trellis/workspace/nuts2k/journal-1.md`

> W1/W2 会触发真实出图调用，**要花钱**。先用 `--dry-run` 与只读命令把逻辑跑通，
> 出图只在最后确认阶段跑一次，且尽量控制在 1–2 页。

## T9 全量检查与收口

- [ ] `pnpm format:check && pnpm typecheck && pnpm test && pnpm build && git diff --check`
- [ ] 测试总数 ≥ 774 且 S1–S8 每条有对应用例（A①-6）
- [ ] A①-5 契约未变：`git diff -- packages/core/src/content-spec-contracts.ts
      packages/core/src/constants.ts apps/cli/src/providers/page-generation.ts` 为空
- [ ] Phase 3：新增错误码登记进 `.trellis/spec/backend/error-handling.md`；
      `.trellis/spec/backend/contracts.md` 补〈规格写入唯一入口〉一节，
      并把〈模型可提案、不可直接落盘〉的状态从「实现尚未落地」更新为已落地部分
- [ ] 提交并 `task.py finish`

## 验证命令速查

```bash
pnpm --filter @ppt-maker/core test
pnpm --filter @ppt-maker/cli test
pnpm format:check && pnpm typecheck && pnpm test && pnpm build
rg -n "writeDeckContentSpec" apps packages --glob '!**/test/**'
```
