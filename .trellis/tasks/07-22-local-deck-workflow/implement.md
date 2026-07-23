# M3 实施计划

## 阶段划分

按依赖顺序分 5 个阶段，每阶段完成后可独立验证。

---

### 阶段 1：Deck 契约与基础设施

**目标**：定义 deck manifest schema，实现 deck workspace 的创建和加载。

- [ ] 1.1 `packages/core/src/deck-contracts.ts`：DeckSlideEntrySchema、DeckExportRecordSchema、DeckManifestSchema
- [ ] 1.2 `packages/core/src/index.ts`：导出 deck-contracts
- [ ] 1.3 `apps/cli/src/deck/workspace.ts`：createDeckWorkspace（扫描目录、排序、逐个调用 createSlideWorkspace、写入 deck-manifest.json）、loadDeckWorkspace
- [ ] 1.4 `apps/cli/src/index.ts`：注册 `deck init` 命令
- [ ] 1.5 `packages/core/test/deck-contracts.test.ts`：schema 解析/拒绝测试

**验证**：
```bash
pnpm typecheck
pnpm test
pnpm ppt-maker deck init --images fixtures/single-slide --workspace /tmp/test-deck
ls /tmp/test-deck/deck-manifest.json /tmp/test-deck/slides/
```

---

### 阶段 2：扩展 runSlideRunFrom 支持自动通过门

**目标**：slide run --from 支持 --confirm-api 和 --confirm-upload 参数。

- [ ] 2.1 `apps/cli/src/slide/run-from.ts`：RunFromOptions 增加 confirmApi / confirmUpload 可选参数
- [ ] 2.2 同文件：assist-review 分支在 confirmApi === true 时自动调用 runAssistReview
- [ ] 2.3 同文件：clean 分支在 confirmUpload === true 时自动调用 runSlideClean
- [ ] 2.4 `apps/cli/src/index.ts`：slide run 命令增加 --confirm-api 和 --confirm-upload 选项并透传
- [ ] 2.5 现有 run-from 测试不回退

**验证**：
```bash
pnpm typecheck
pnpm test
```

---

### 阶段 3：deck run + deck status

**目标**：实现批处理执行和状态查看。

- [ ] 3.1 `apps/cli/src/deck/run.ts`：runDeckPipeline — 逐页串行调用 runSlideRunFrom，收集每页结果
- [ ] 3.2 `apps/cli/src/deck/status.ts`：deckStatus — 逐页读取 slide manifest，汇总统计
- [ ] 3.3 `apps/cli/src/index.ts`：注册 deck run、deck status 命令
- [ ] 3.4 deck run 结果输出格式：每页状态 + 汇总

**验证**：
```bash
pnpm typecheck
pnpm test
pnpm ppt-maker deck status /tmp/test-deck
```

---

### 阶段 4：deck export（多页 PPTX 合并）

**目标**：合并多页为单一 PPTX 文件。

- [ ] 4.1 `apps/cli/src/pptx/synthesize.ts`：新增 synthesizeDeckPptx 函数
- [ ] 4.2 `apps/cli/src/deck/export.ts`：exportDeckPptx — 逐页判断 native/placeholder，调用 synthesizeDeckPptx，写入 exports 记录
- [ ] 4.3 `apps/cli/src/index.ts`：注册 deck export 命令（含 --strict 选项）
- [ ] 4.4 `packages/core/src/deck-contracts.ts`：DeckExportRecordSchema 包含导出时间、包含页数、占位页数、输出路径

**验证**：
```bash
pnpm typecheck
pnpm test
# 手动验证：用合成 fixture 创建 deck，直接 export（全占位页），确认 PPTX 可在 PowerPoint for Mac 打开
```

---

### 阶段 5：deck add-slide / remove-slide

**目标**：支持向已有 deck 追加或移除页面。

- [ ] 5.1 `apps/cli/src/deck/add-slide.ts`：追加 slide workspace 到 deck，更新 deck-manifest.json
- [ ] 5.2 `apps/cli/src/deck/remove-slide.ts`：软删除（设置 removedAt），不删除磁盘数据
- [ ] 5.3 `apps/cli/src/index.ts`：注册 deck add-slide、deck remove-slide 命令

**验证**：
```bash
pnpm typecheck
pnpm test
pnpm ppt-maker deck add-slide /tmp/test-deck fixtures/single-slide/complex-page.png
pnpm ppt-maker deck status /tmp/test-deck
pnpm ppt-maker deck remove-slide /tmp/test-deck page-01
pnpm ppt-maker deck status /tmp/test-deck
```

---

## 风险文件

| 文件 | 变更类型 | 风险 |
|---|---|---|
| `apps/cli/src/slide/run-from.ts` | 扩展接口 | 中 — 需确保默认行为不变 |
| `apps/cli/src/pptx/synthesize.ts` | 新增函数 | 低 — 不修改现有 synthesizePptx |
| `apps/cli/src/index.ts` | 注册新命令 | 低 — 追加不修改 |

## 回滚点

每个阶段独立可验证。阶段 2 修改了现有文件（run-from.ts），是唯一有回退风险的阶段，其他阶段均为新增文件。
