# 子任务①技术设计

契约字段与语义以父任务 `design.md` §1–§5 为唯一来源，本文只解决**落到哪一行代码**，
以及父任务留给本子任务定夺的实现口径。

## 1. 调研结论（代码事实）

| 事实 | 位置 | 对本任务的意义 |
|---|---|---|
| `loadSlideWorkspace` 是**唯一**的 manifest 解析入口，桌面端经 `@cli/slide/workspace.js` 复用 | `apps/cli/src/slide/workspace.ts:309`；`apps/desktop/src/main/ipc/{slide,deck}.ts`、`runner/deck-runner.ts` | 归一化只需落在这一处，CLI 与桌面端同时覆盖 |
| 解析用 `SlideWorkspaceManifestSchema.parse`，`superRefine` 要求每个 `SlideStage` 都有状态 | `workspace-contracts.ts:245`、`workspace.ts:313` | 归一化必须在 `parse` **之前**，见 §3 |
| `ocr` 有依赖守卫 `assertStageDependenciesCompleted(states,"ocr")` | `apps/cli/src/slide/ocr.ts:110` | 只要改阶段依赖，闸门自动生效，无需在每个消费方加判断 |
| `writeWorkspaceManifest` 也走 `parse` | `workspace.ts:333` | 归一化后的对象写回天然合法；纯读路径不写盘，旧文件保持原样 |
| `readExistingReview` 按**固定路径**读，与 attempt 无关，ENOENT → `null` | `apps/cli/src/slide/review.ts:116` | 只要固定路径没有文件，人工块自然不被继承，无需改 review.ts |
| `runAcceptClean` 是验收门的完整范式（校验上游 → 写 accepted.json → 建资产 → 追加 attempt → 置 completed） | `apps/cli/src/clean/accept.ts:57` | `accept-source` 照抄结构，只换 stage / 路径 / 上游 |
| `RUN_SEQUENCE` 不含 `init`，从 `ocr` 起 | `apps/cli/src/slide/run-from.ts:19` | 新阶段要插到序列首位，并新增一个 gate 分支 |
| 桌面端 `RUN_STAGE_SEQUENCE` / `STAGE_LABELS` / `GATE_LABELS` 是展示侧单点定义 | `apps/desktop/src/shared/stages.ts:16,37`、`gates.ts:12` | 三处同步，否则轨道缺节点、日志退化成英文 id |
| `add-slide` 是 deck 薄包装的范式（load → 调 slide 层 → 写 deck manifest） | `apps/cli/src/deck/add-slide.ts:43` | `deck replace-source` 照此结构 |
| `createInitialStageStates` 用 `stage === "init"` 判定初始 completed | `packages/core/src/stage-graph.ts:54` | 需扩展为可传入「哪些阶段初始即 completed」 |

## 2. 契约落点

新建 `packages/core/src/source-contracts.ts`，从 `index.ts` 导出。理由：
`workspace-contracts.ts` 已 269 行且承载全部工作区契约，来源是一个独立维度，
②③ 还会继续往各自分支加字段；独立文件让后续改动不与阶段/资产契约互相干扰。

`SlideSourceSchema = z.discriminatedUnion("kind", [...])`，三分支字段照父任务 `design.md` §2。

`SlideWorkspaceManifestSchema` 增 `source: SlideSourceSchema.nullish()`（磁盘可选）。
**导出两个类型**：

- `SlideWorkspaceManifest`：`source: SlideSource`（必填）——业务代码用的类型
- 磁盘 schema 允许缺省，仅在解析边界内可见

做法：schema 用 `.nullish()`，`loadSlideWorkspace` 归一化后 `as` 到必填类型不可接受
（会骗过编译器）。改为**归一化产出完整对象后再 parse**，让 `parse` 的返回类型天然必填：
即 schema 本身声明 `source: SlideSourceSchema`（必填），可选性只体现在归一化函数的**入参**类型上。
这样 S3「内部必填」由类型系统保证，而非约定。

## 3. 归一化：先于 parse，作用于原始 JSON

```
loadSlideWorkspace:
  raw = JSON.parse(manifest.json)
  normalized = normalizeManifest(raw, config)     // 纯函数，core 内
  manifest = SlideWorkspaceManifestSchema.parse(normalized)
```

`normalizeManifest` 只做两件事，都只在缺失时补：

1. `source` 缺失 → 补 `ImportedSource`：
   - `originalFileName` = `basename(config.sourceImagePath)`
   - `attemptId` = `init` 阶段的 `lastSuccessfulAttemptId`
   - `recordedAt` = manifest 的 `createdAt`（不是 `now()`——写 now 等于声称「今天导入的」，与事实不符）
2. `stages` 中无 `accept-source` → 追加一条 `completed` 状态，
   `latestAttemptId` / `lastSuccessfulAttemptId` / `completedInputFingerprint` 全部沿用 `init` 的值。

**顺序不可颠倒**：`parse` 在前会先撞 `superRefine` 的缺阶段校验，归一化永远执行不到。
这是父任务 RK4 的落地点。

归一化是纯内存的。只读命令（`deck status`）不写盘，旧工作区文件保持原样——B1 断言这一点。
首次发生写操作时（任何 `writeWorkspaceManifest`）新字段自然落盘，无独立迁移程序。

`normalizeManifest` 放 core（`source-contracts.ts` 或同目录 `manifest-normalize.ts`），
不放 CLI：它是契约的一部分，②③④ 与未来的消费方都要用同一份。

## 4. `text_review` 的处理口径（父任务 §4.3 择一）

**选定：按 attempt 归档，不删文件、不删资产记录。**

换源时把 `stages/review/text-blocks.json` 移动到
`stages/review/archived/<新 init attemptId>/text-blocks.json`，
并把对应资产记录的 `path` 改为归档路径、`id` 改为 `asset-text-review-archived-<attemptId>`。

为什么这个方案优于「连同资产记录一并移除」：

- `readExistingReview` 读的是**固定路径**（`review.ts:116`），归档后该路径 ENOENT → 返回 `null`
  → `mergeTextBlockCandidates` 的 `existing` 为 `null` → 人工块不被继承。
  **`review.ts` 一行都不用改**，父任务的硬约束自动满足。
- 资产记录始终指向真实存在的文件，不产生悬空引用。
- 人工复核是有成本的劳动。删掉它换来的只是少一个目录；留下来则「换错图了想换回去」时
  还有据可查。M4 的教训是「记录与事实相反」，不是「记录太多」。
- 归档资产必须换 `id`：`text_review` 资产 id 是固定值（`review.ts:298` 附近），
  沿用会被下一次 review 写入覆盖，归档记录随即丢失。

`review_validation` 资产同样基于旧图，同批归档（同一目录），理由相同。

`--keep-review` 时**不归档**：文件留在原路径，下次 review 走既有 IoU 对齐路径继承人工块。
父任务已论证这不构成静默分歧——它是用户显式勾选的结果。

## 5. `accept-source` 的两条路径

### 5.1 人工确认（`generated`）

新建 `apps/cli/src/slide/accept-source.ts`，结构照抄 `clean/accept.ts:57`：

- 上游校验：`init` 必须 `completed` 且有 `lastSuccessfulAttemptId` / `completedInputFingerprint`
- 被验收产物 = 当前 `sourceImageAssetId` 指向的资产，先 `assertWorkspaceAssetIntegrity`
- 写 `stages/source/accepted.json`，`ArtifactAcceptance.stage = "accept-source"`，
  `upstreamFingerprint` 取 `init` 的 `completedInputFingerprint`
- 新资产 role：复用现有 role 会语义错位，新增 `source_acceptance`
  （父任务 §5 的枚举表未列此项——它是本子任务落地 `accept-source` 的必然产物，
  属于同一决策的实现细节，不构成契约偏离；在 Phase 3 更新父任务 §5 的表）
- 追加 attempt（`provider: "developer"`）、置 `accept-source` 为 `completed`
- checklist 留空 `{}`：与 `accept-final.ts:21` 的判断一致——没有逐项勾选就不要伪造勾选记录

### 5.2 自动放行（`imported` / `extracted`）

**发生在创建/换源时，不是一个可调用的命令**。`createSlideWorkspace` 与 `replaceSlideSource`
在写 manifest 时按来源直接决定 `accept-source` 的初始状态：

- `generated` → `pending`，无 attempt
- 其余 → `completed`，追加一条 `accept-source` attempt：
  `provider: "auto-source-trust"`、`inputFingerprint` 取 `init` 的指纹、`assetIds: []`、
  `status: "completed"`

**不写 `accepted.json`，不建验收资产。** 判据（B5）就是磁盘上有没有这个文件。

`createInitialStageStates(initAttemptId, fingerprint)` 增加第三个参数
`autoCompletedStages: readonly SlideStage[]`（默认空），由调用方传 `["accept-source"]`。
不在 core 里写 `stage === "accept-source"` 的硬编码——core 不该知道来源规则。

判定函数放 core 并单点定义：

```
requiresSourceAcceptance(source: SlideSource): boolean   // kind === "generated"
```

CLI、桌面端、②③④ 全部调它，不各写各的 `kind === "generated"`。

## 6. 换源执行序列

`apps/cli/src/slide/replace-source.ts`：

1. `assertWideImage(newImagePath)` + 格式校验（复用 `normalizeImageFormat` 的等价逻辑）
2. 复制新图为**新资产**（`inputs/source-<n>.<ext>`，id `asset-source-image-<n>`）。
   旧资产记录与文件**保留**——换源历史因此天然可查
3. 追加 `init` attempt（number 递增），`inputFingerprint` 按 `createSlideWorkspace` 同一公式
   （`sha256Values([源图 sha, 参考文 sha ?? "no-reference", "workspace-version:1"])`）重算
4. 更新 `sourceImageAssetId`、`config.sourceImagePath`、`manifest.source`（来源信息随本次 attempt）
5. 按 §4 归档或保留 `text_review`
6. `invalidateStageAndDownstream(stages, "accept-source", reason, now)`
7. 覆写 `accept-source` 状态：按**新来源**重新判定（生成 → `pending` 且清空 attempt 关联；
   其余 → `completed` 并追加一条 `auto-source-trust` attempt）

第 6 步起点是 `accept-source` 而非 `init`：`init` 刚刚成功，标 `stale` 与事实相反。
第 7 步必须在第 6 步**之后**——`invalidateStageAndDownstream` 会把 `accept-source` 一并转 `stale`，
顺序颠倒会被覆盖掉。

`init` 阶段状态需同步更新 `latestAttemptId` / `lastSuccessfulAttemptId` /
`completedInputFingerprint` 为新 attempt 的值，否则下游指纹判定仍认旧图。

失效只作用于本页，deck 层不做任何跨页联动（B8）。

## 7. 执行序列与展示侧同步

三处必须同批改，漏一处就出现「界面说完成、实际没跑」这类静默分歧：

| 位置 | 改动 |
|---|---|
| `apps/cli/src/slide/run-from.ts:19` | `RUN_SEQUENCE` 首位插入 `accept-source`；新增分支：状态非 `completed` 时返回 `gate: "source"`、`stoppedAt: "accept-source"`、`nextCommand: ppt-maker slide accept-source <ws>` |
| `RunFromResult.gate` 联合类型 | 增 `"source"` |
| `apps/desktop/src/shared/stages.ts` | `RUN_STAGE_SEQUENCE` 首位加 `accept-source`；`STAGE_LABELS` 加「确认源图」 |
| `apps/desktop/src/shared/gates.ts:12` | `GATE_LABELS` 加 `source: "停在源图确认"` |

桌面端 `deriveStageDetails`（`main/slide-detail.ts:179`）按 `RUN_STAGE_SEQUENCE` 映射
manifest 状态，加了阶段即自动出现在轨道上，无需额外改动。
待办队列按 `gate !== null` 收集，新 gate 自动进队列——父任务 §4.5「无需新造机制」在此验证成立。

## 8. deck 层

`apps/cli/src/deck/replace-source.ts`，结构照 `add-slide.ts:43`：
load deck → 按 `pageLabel` / `slideId` 定位 entry → 调 slide 层 `replaceSlideSource` →
更新该 entry 的 `sourceImageName` 与 `updatedAt` → 写 deck manifest。

`DeckSlideEntry` 不加来源字段（父任务 §1：来源属于 slide，deck 不冗余）。
`deck status` 显示来源时从已加载的 slide manifest 读——`status.ts:88` 已在逐页 load。

## 9. 桌面端换源入口

本任务只做**单页换源入口**（批量确认界面归 ④）：slide 详情视图提供「换源」动作，
选新图 → 二次确认（说明「该页复核成果将清空」）→ 勾选框「保留已确认的文字块」默认**不勾**。
实现前读 `DESIGN.md`，遵循既有对话框/按钮样式，不新造视觉语言。

IPC 新增一个 handler，直接调 CLI 的 `replaceSlideSource`，不在 main 侧复写判断逻辑（S9）。

## 10. 测试策略

必须有的（B10 准入）：

- **旧 manifest 加载回归**：构造一份无 `source`、无 `accept-source` 的 fixture manifest，
  断言 `loadSlideWorkspace` 成功、`source.kind === "imported"`、`accept-source` 为 `completed`、
  且**读操作后磁盘文件字节未变**
- `requiresSourceAcceptance` 三个来源的判定
- 自动放行页磁盘上不存在 `accepted.json`
- `generated` 页在 `ocr` 前被依赖守卫拒绝
- 换源后：`init` 仍 completed、`accept-source` 及下游 stale、原路径 review 文档消失、
  manifest 中所有资产路径均存在（悬空检查）
- 换源 `--keep-review` 保留人工块
- deck 内换源不影响其它页（比对其余页 manifest 字节）

## 11. 不做

- 不升 `SCHEMA_VERSION` / `workspaceVersion` / `deckVersion`
- 不写迁移脚本
- 不在本任务实现 `extracted` / `generated` 的**产生**路径
- 不动 `mergeTextBlockCandidates` 的既有合并行为
