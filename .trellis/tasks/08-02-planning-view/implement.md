# planning 视图执行计划（M6 子任务②）

分层推进，每层自带验证。**实现前先读 `DESIGN.md`**（CLAUDE.md 硬要求）与
本任务 `design.md`。

## 验证命令（本仓真实可跑的四件套）

```bash
pnpm --filter @ppt-maker/core build   # 必须先跑；dist 不入库，跳过它 typecheck 连环报错
pnpm typecheck
pnpm format:check                      # biome。本仓没有 lint 脚本，pnpm -r lint 跑不通
pnpm -r test                           # 基线 854：core 141 / desktop 474 / cli 239
```

真机走查前还要 `pnpm --filter @ppt-maker/cli build`（`tools/snap.sh` 走 `apps/cli/dist`）。

## L1 纯函数层（无 IPC、无组件）

- [x] 新建 `renderer/lib/planning-core.ts`，与 `source-picker-core.ts` 同构：
      相对 `.js` 导入、不碰 `window`，以便 vitest 直接解析。
- [x] `isDirty(saved, draft)`：包 `diffContentSpec`，见 design §4.1。
- [x] `classifyOutdatedPages(slides)`：从 `SlideDetail[]` 分出 drifted / missing /
      不适用（非 `generated`）三类。
- [x] `buildRegenerateBatchConfirm(pageLabels)`：确切页数 + 不可撤销 + 下游影响
      （OCR 基准更新、逐张重新确认源图），见 design §5.3。
- [x] `isEmptyChangeRecord(record)`：`fingerprints` 为空即真，见 design §6。
- [x] 用例进 `apps/desktop/test/planning-core.test.ts`。

**验证**：`pnpm --filter @ppt-maker/desktop test`。
每条断言写完后做一次变异验证（改反实现让它红），尤其 `isDirty` 与分类函数。

## L2 main 侧 IPC

- [x] `channels.ts` 加五个通道的出入参类型（design §3）。
- [x] `deck.ts` 实现 handler；`deck:create-empty` 写活动日志，与 `deck:create` 同形。
- [x] `deck:apply-spec-change` 的失败路径补齐坏页上下文（design §7.1），
      复用 `buildDeckStatusDetailed`，**不写第二份探测逻辑**。
- [x] `preload/index.ts` 逐条转发。
- [x] 用例：临时 deck + 故意写坏一页 slide manifest，断言错误消息里点名了那一页。

**验证**：`pnpm typecheck && pnpm --filter @ppt-maker/desktop test`。

**回滚点**：本层纯新增，删掉五个 handler 与类型即可回到 L1 状态。

## L3 批量重生成接进 SourceTaskRunner

- [x] `SourceTaskKind` 加 `"regenerate-batch"`，`SourceTaskRequest` 加对应分支。
- [x] `SourceTaskRunner` 里包 `runDeckRegenerateBatch`，`selection` 恒为
      `{kind: "labels", labels}`（**不用 `all-drifted`**，理由见 design §5.2）。
- [x] 进度事件归一到既有 `SourceTaskProgress` 形状，不新增事件类型。
- [x] 用例：stub generator 注入，断言
      ① 只跑勾选页；② 未勾选页**字节不变**（递归哈希比对）；③ 单页失败不终止其余页。

**验证**：同上。②③ 两条都必须先变异验证过（把选页改成"选全部"、把失败改成上抛，
断言要真的红）。

**回滚点**：`SourceTaskKind` 是联合类型，删掉新分支后 TS 会直接指出所有引用点。

## L4 视图骨架与路由

- [x] `ui-store.ts`：`AppView` 加 `"planning"`，加 `openPlanning` /
      `openPlanningForNewDeck` 两个 action（对外唯一入口）。
- [x] `App.tsx` 加分支，**不绑 key**（design §2.1）。
- [x] 新建 `renderer/stores/planning-store.ts`（design §4.1）。
- [x] 新建 `renderer/pages/PlanningPage.tsx`：左栏 + 右栏骨架，先只渲染空态。
- [x] 两个入口接上：控制台空态 / 顶栏「新建策划」、deck 已打开时的「改规格」。
- [x] 新建走原生 `showOpenDialog` 选父目录 + 界面内填 deck 名。

**验证**：`pnpm typecheck`；跑起桌面端确认视图能进能出。

## L5 编辑器

- [x] `style.description` 大文本框 + 常驻爆炸半径说明（design §4.3）。
- [x] 条目列表 + 逐字段编辑器：`pageType` / `textGroups`（分组与条目增删改）/
      `visualIntent` / `revisionNotes`（**可删**）。
- [x] `textGroups` 区块常驻 OCR 基准说明（design §4.4）。
- [x] 条目上移 / 下移按钮，不做拖拽。
- [x] 显式「保存」按钮 + 脏标记；离开拦截（切视图、切工作区两处）。
- [x] 保存结果条：`drifted` / `missing` 计数如实报告；
      `historyWritten === false` 用**警示样式**出声（design §7.2）。

**逐组件对照 DESIGN.md**：六态（default / hover / focus-visible / active /
disabled / loading）是硬性要求，少一个算未完成；全屏唯一一个 primary 按钮；
状态色只来自唯一映射表，组件内不得就地拼色。

## L6 过时页清单与批量重生成

- [x] 清单取**全量** drifted（`deck:status-detailed` 的 `specDrift`），不取增量。
- [x] 默认全选、可逐页取消（D9）。
- [x] `missing` 单列、不可勾选，给去控制台删页的指引。
- [x] 付费确认走 `window.api.system.confirm` + `buildRegenerateBatchConfirm`。
- [x] 发起后关闭清单，进度归控制台的建页任务条（与 SourcePicker 同一形态）。

## L7 历史面板与回滚

- [x] 左栏倒序列出记录；展开显示逐条 diff，**直接读记录字段**（design §6）。
- [x] 零变更记录用次级样式 + 「无内容变更」标注。
- [x] 回滚按钮 + 确认文案写明「回滚是一次新的前进，不抹历史」。

## L8 兼容性验证（真实工作区，只读副本）

一律先 `cp -R` 到 scratchpad 再操作，不碰 `~/test/` 原件；操作后用递归哈希验证原件未变。

- [x] 旧格式：`~/test/ppttest-2026-07-25`（2 页 imported、无 `content-spec.json`）
      打开工作台不报错、**不被改写**（A6）。
- [x] 混合来源：`~/test/wt4-append`（11 页，只有 page-11 是 `generated`）
      非 `generated` 页完全不入清单。
- [x] 零页 deck：新建一个空 deck，控制台与工作台都如实显示（V5 / R8）。

## L9 真机走查（唯一花钱的一步）

- [x] 复用归档工具
      `.trellis/tasks/archive/2026-08/07-31-page-sources-and-content-generation/tools/`
      （`restart.sh` / `cdp.mjs` / `main-cdp.mjs` / `patch-dialog.js` / `snap.sh`）。
      原生对话框必须打桩，理由见 `tools/README.md`。
- [x] **开跑前**：`node apps/cli/dist/index.js deck status <副本> --json`
      确认 drifted 集合。`~/test/wt4-spec-2026-08-02` 基线里 **page-04 本来就是
      drifted**，照搬脚本改另一条会变成 2 页 = 2 倍花费。
- [x] 只跑 **1 页**真实重生成，验证 `reference_text` 资产确实更新、新 sha 进指纹。
- [x] 开工前 `pkill -9 -f "electron@43.2.0"`，并确认
      `lsof -iTCP:9222 -iTCP:5858` 归同一个 PID（两个实例抢端口会让补丁打在 A、
      界面跑在 B）。

## 风险与回滚

| 风险 | 触发 | 处理 |
|---|---|---|
| 关窗丢未保存草稿 | 用户直接关窗 | **已知缺口**（design §4.2），不在本轮修；实现时在 PR 说明里列明 |
| 批量误跑多页 | 基线 drifted 集合未先确认 | L9 第二条是硬前置，不做不许开跑 |
| 两个 Electron 实例抢端口 | 走查时旧实例没杀干净 | L9 最后一条 |
| 测试基线倒退 | 新增用例与既有用例互相干扰 | 每层结束跑一次 `pnpm -r test`，不攒到最后 |

## 完成条件

- [x] `pnpm typecheck` / `pnpm format:check` 全过
- [x] `pnpm -r test` **不低于 854**，新增能力均有对应用例
- [ ] 本任务 prd 的六条 Acceptance Criteria 逐条有证据（离线用例或走查记录）
- [x] 变异验证记录：至少对「未勾选页字节不变」与 `isDirty` 各做过一次

## 实施证据（2026-08-04）

- L1：`planning-core.test.ts` 5 条通过；曾临时反转 `isDirty` 与清单分类实现，断言均转红后恢复。
- L2：`planning-ipc.test.ts` 覆盖坏页点名、空摘要、Deck 名路径边界与执行互斥。
- L3：`planning-batch-runner.test.ts` 覆盖勾选子集、未勾选页递归哈希不变、单页失败继续；
  曾分别临时改成“追加未选页”和“只传第一条标签”，断言均转红后恢复。
- L4–L7：路由、store、编辑器、全量过时清单、批量确认、历史与回滚均已接入；
  工作区切换与建页任务执行期间的竞态由 renderer + main 双层守卫。
- 提交前门禁：core 141 / desktop 497 / cli 239，共 877 条测试通过；typecheck 与 Biome 通过。
- 新建空 Deck 的并发守卫使用 deferred 覆盖「创建请求在途时切换工作区，迟到结果不得覆盖」及
  「未切换时照常写入」正对照；顶栏菜单在 Deck 加载期间同步禁用切换入口。
- L8：在 `/tmp/ppt-maker-planning-l8.vSS2cn` 的真实副本完成；旧格式规格读取与 status 前后递归哈希
  不变，混合来源仅 1 页 generated 参与规格状态，零页 Deck 的 status 为 0 页。
- L9：在用户单独确认付费后，于 `/tmp/ppt-maker-planning-l9.FEQI3b/deck` 完成 1 页真实重生成。
  开跑前只有 `page-04` 为 drifted；原生确认框记录为「调用 1 次图像生成」「按次计费且不可撤销」，
  并说明 OCR 基准更新与逐张重新确认。任务结果为成功 1、失败 0、跳过 0。
- L9 落盘证据：`page-04` 回到 in-sync，新增 `inputs/reference-3.txt`，其 SHA-256 为
  `2eef1f6a922666feb5655fc3fbac238423cdac38ca215265f720d73efd6e1dc0`；页面规格指纹从
  `99139c4ed6792ae958372121c18e4d55dbdff0296305bf9e78a8a9d0e344552f` 更新为
  `bee46f6e7b0ee74335f4d52bb093697cf147eb2868f6d6fef62ef3288159f69e`。
  page-01～03 的目录递归哈希逐字节不变，只有 page-04 改变；`~/test/` 原始 Deck 前后快照不变。
  归档 `snap.sh` 的 status 解析仍依赖旧字段，本次未改归档脚手架；状态证据直接取当前 CLI JSON，
  零变化证据复用该脚本相同的逐页递归 shasum 算法。
- 关窗未保存拦截仍按 design §4.2 作为已知缺口。
