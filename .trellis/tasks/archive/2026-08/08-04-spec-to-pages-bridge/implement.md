# 执行计划：规格产出到建页的衔接

顺序是硬的：T1 → T7。T1 是唯一动 CLI 的一步，单独成提交（design §7 的回滚点）。

## 前置（开工第一件事）

- [ ] P1 `git status` 干净；`pnpm --filter @ppt-maker/core build` 先跑一次
      （拉取后 `core/dist` 必然过期，否则 `apps/cli` typecheck 报一堆假的
      `has no exported member`——这个坑已复发两次）
- [ ] P2 取基线：`pnpm test` 期望 **948**（core 156 / desktop 527 / CLI 265）
- [ ] P3 复核 `prd.md` F1–F13 与代码一致，**不一致先回 prd 订正再动手**
- [ ] P4 读 `DESIGN.md`（CLAUDE.md 硬性要求，动界面前必读）

## T1 CLI 条目子集（唯一 CLI 改动，单独提交）

- [ ] `DeckGenerateOptions` 加可选 `entryIds`（design §3.1）
- [ ] 过滤点在 `reconcileDeckSpec` 之后、建页循环之前；
      **未知 id 校验须前移到建页循环之前**，抛既有 `SPEC_PAGE_NOT_FOUND`，整体拒绝
- [ ] 测试 `apps/cli/test/deck-generate.test.ts` 增：
      传 2 个 id → 只建 2 页、`skipped` 含其余；
      传未知 id → 抛 `SPEC_PAGE_NOT_FOUND` 且**一页都没建**（deck 目录内容哈希不变）；
      省略 `entryIds` → 与既有用例逐字同结果
- [ ] 验证：`pnpm --filter @ppt-maker/cli test`
      —— **既有 deck-generate 用例一条断言都不许改**（改了就说明默认行为变了）

**回滚点 RB1**：本步单独提交。

## T2 渲染层纯函数

- [ ] `renderer/lib/planning-core.ts` 加 `classifyPendingEntries(spec, slides)`
- [ ] 口径与 CLI `collectGeneratedPages` 逐条对齐：**排除 removed、只认 generated**（design §2.2）
- [ ] 加 `buildCreatePagesConfirm(count)`，确切次数口径（design §4）
- [ ] 测试 `apps/desktop/test/planning-core.test.ts`：
      零页 deck 全部条目待建；建了 2 页后只剩其余；
      **软删除一页后它的条目重新出现在待建**（design §2.2 的既有语义，钉住它）；
      非 generated 页的 specEntryId 不参与匹配；
      确认文案是「将调用 N 次」而非「最多」

## T3 IPC 契约放宽与透传

- [ ] `channels.ts` generate 分支：`specPath` 改可选、加 `entryIds`（design §3.2）
- [ ] `source-task-runner.ts` case "generate" 透传两者
- [ ] 测试：不传 specPath 时 `runDeckGenerate` 收到的入参不含 specPath；
      `entryIds` 原样透传
- [ ] 验证：既有 SourcePicker 两条路的用例全绿（它们照旧传 specPath）

## T4 SourceTaskBar 提取

- [ ] 从 `ConsolePage.tsx:222` 搬到 `renderer/components/` 下，纯搬运不改行为
- [ ] `ConsolePage` 两处引用改为 import
- [ ] 验证：既有控制台用例全绿（**不许改断言**）

## T5 策划页「待建页」一档

- [ ] 面板渲染条件放宽为三类任一非空（R2；现在是 `drifted===0 && missing===0` 即不渲染）
- [ ] 新增「待建页」档：默认全选、可逐条取消、条目显示 pageType + 标题（D3，复用 `summarizeSpec`）
- [ ] 建页按钮：dirty / 建页任务运行中时禁用并给 title（D6，沿用 drifted 那档的措辞）
- [ ] 接 `SourceTaskBar`（T4）到策划页
- [ ] 完成后 `refreshStatus()` + 完成提示 + 「去控制台」按钮，**不自动跳转**（D5）
- [ ] 部分失败：成功页与失败条目分别呈现，不吞失败（R6）
- [ ] 测试 `apps/desktop/test/planning-*.test.ts`：
      勾选数变化 → 按钮数字同步；只勾 1 条 → 请求里 `entryIds` 长度为 1；
      dirty 时禁用；完成后不发生视图切换

## T6 控制台空态指路

- [ ] 零页时调既有 `readDeckSpec`，有待建条目 → 写明条数 + 指向策划工作台
- [ ] 无规格（返回 null）或读失败 → **退回现有文案，不报错**（design §6）
- [ ] 测试：三条分支各一例，含读失败降级

## T7 全量检查与收口

- [ ] `pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
      （**别用 `| tail`**，退出码会变成 tail 的，真实失败被掩盖——已踩过）
- [ ] 测试总数 ≥ 948 且 R1–R8 每条有用例（A10）
- [ ] 真机走查：客户端已在跑，零页 deck 上走「待建页 → 只勾 1 条 → 建页」全程
      —— **会花钱**，只跑 1 页
- [ ] `git diff` 确认没碰 `content-spec-contracts.ts` / `constants.ts` / `page-generation.ts`
- [ ] Phase 3：`.trellis/spec/` 按需沉淀；提交并 `task.py finish`

## 验证命令速查

```bash
pnpm --filter @ppt-maker/core build     # 先跑，否则 cli typecheck 假失败
pnpm --filter @ppt-maker/cli test
pnpm --filter @ppt-maker/desktop test
pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```
