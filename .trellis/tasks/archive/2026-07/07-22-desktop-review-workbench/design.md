# M4 桌面复核工作台 V2 — 技术设计

> 对应 PRD 决策 D1–D4。V1 的画布内核组件保留，其余 renderer 层与 main 进程执行层重构。

## 1. 架构总览

```
┌─ renderer ────────────────────────────────────────────┐
│ ConsolePage（控制台）        SlidePage（单页复核）        │
│   ├ RunControlBar             ├ SlideToolbar（重写）     │
│   ├ SlideCardGrid（阶段轨道）   ├ StageRail（常驻）        │
│   ├ TodoQueuePanel            ├ ReviewCanvas ★保留      │
│   └ ActivityPanel             ├ SliderCompare ★保留     │
│                               └ AcceptFlow（重写）       │
│ stores: deck-store / run-store / activity-store / ui  │
└──────────────┬────────────────────────────────────────┘
               │ IPC（invoke + event）
┌─ main ───────┴────────────────────────────────────────┐
│ DeckRunner（串行执行器，唯一执行入口）                     │
│ ActivityLog（userData jsonl 追加写）                    │
│ ipc/deck.ts（status-detailed / run-start / run-stop）  │
│ ipc/slide.ts（review 读写、accept、load-image，保留）     │
│ 业务函数：@cli/deck/* @cli/slide/* @ppt-maker/core 不改  │
└───────────────────────────────────────────────────────┘
```

## 2. main 进程

### 2.1 DeckRunner（新，`src/main/runner/deck-runner.ts`）

应用内**唯一** pipeline 执行入口（批量与单页共用，杜绝并发写 workspace）。

- 状态机：`idle → running → stopping → idle`；内部 FIFO 任务队列，每项 = 一个 slide。
- 批量启动：`loadDeckWorkspace` 取活动页 → 过滤已完成（accept-pptx completed）与已移除 → 全部入队。单页启动：单项入队（运行中则追加排队）。
- 每项执行：读取 slide manifest，计算 `from` = `RUN_SEQUENCE` 中第一个 `status !== "completed"` 的阶段（断点续跑，不重做已完成阶段），调 `runSlideRunFrom(from, { workspacePath, confirmApi, confirmUpload, onStageStart, onStageComplete })`。
- 停止语义：`stop()` 置 `stopping`，当前阶段执行完、当前页返回后不再取下一项。
- 事件广播（`deck:run-progress`）：

```ts
type DeckRunEvent =
  | { kind: "run-start"; total: number; slideIds: string[] }
  | { kind: "page-start"; slideId: string; pageLabel: string; index: number; total: number }
  | { kind: "stage-start"; slideId: string; stage: SlideStage; at: string }
  | { kind: "stage-complete"; slideId: string; stage: SlideStage; at: string; durationMs: number }
  | { kind: "page-done"; slideId: string; gate: string | null; stoppedAt: string | null; message: string; error: { code: string; message: string } | null }
  | { kind: "run-stopping" }
  | { kind: "run-done"; summary: { total: number; completed: number; gated: number; failed: number } };
```

- 每个事件同步写入 ActivityLog（stage-complete 含耗时；page-done 含 gate/错误）。

### 2.2 ActivityLog（新，`src/main/activity-log.ts`）

- 路径：`app.getPath("userData")/activity/<deckId>.jsonl`，追加写，不写 deck 工作区（PRD D4）。
- 记录：`{ at, kind, slideId?, pageLabel?, stage?, result, durationMs?, detail? }`；来源包括 runner 事件、accept-clean/accept-pptx、导出、deck 创建/添加/移除页。
- IPC `activity:list(deckPath, limit=200)`：倒序返回，renderer 按日期分组渲染。

### 2.3 deck:status-detailed（增强只读聚合）

`deckStatus()` 提供 currentStage/stageStatus/summary（沿用）；main 进程再对每个活动页 `loadSlideWorkspace` 读取 manifest，聚合：

```ts
interface SlideDetail extends DeckSlideStatus {
  stages: { stage: SlideStage; status: string }[];        // 10 阶段全量
  lastError: { stage: string; code: string; message: string } | null; // 最近 failed attempt
  stageDurations: Record<string, number>;                  // attempts startedAt/endedAt 求得
}
```

错误与耗时来自 manifest `attempts`（持久化，重启可恢复）——V1 未利用的关键数据源。只读聚合不构成对业务契约的绕过。

### 2.4 保留的 IPC

`slide:load-review / save-review / accept-clean / accept-pptx / load-image`、`deck:open / create / add-slide / remove-slide / export`、`system:*` 保留；**移除 `slide:run`**（执行统一走 DeckRunner）。accept-* 与 export handler 追加 ActivityLog 记录。

## 3. renderer

### 3.1 stores

| store | 职责 | 关键点 |
|---|---|---|
| deck-store | deckPath、SlideDetail[]、summary | 打开/刷新时 `deck:status-detailed`；`page-done` 后增量刷新该页 |
| run-store | 执行态：status、当前页/阶段、stageStartedAt、本次 run 各页 live 阶段状态 | 订阅 `deck:run-progress`；耗时用 1s ticker 基于 stageStartedAt 计算；重启后耐久态由 deck-store 提供 |
| activity-store | 日志列表 + live 追加 | 初始 `activity:list`，run 事件到达时本地追加 |
| ui-store | 视图路由（console/slide）、选中页/块、队列面板展开态 | 沿用改造 |

删除 V1 `pipeline-store`（全局单例缺陷的根源）。

### 3.2 待办队列推导（不新增持久化）

纯派生数据，来源两层合并：

- **耐久层**（manifest，重启可恢复）：`stageStatus ∈ {failed, interrupted, stale}` → 失败组；10 阶段中 clean completed 且 accept-clean 未 completed → 待验收 clean；pptx completed 且 accept-pptx 未 completed → 待验收 pptx。
- **会话层**（run 结果）：`gate === "validation-failed"` → 需复核校验组（耐久层无法区分该态，重启后该页表现为停在 validate-review，归入失败组提示重跑）。

### 3.3 页面结构与 DESIGN.md 映射

**AppShell**：`top-nav`（64px、canvas 白底）——wordmark + deck 名（title-sm）+ doctor 状态 chip（caption）+ 右侧「导出 PPTX」`button-primary`（近黑 #181d26、rounded-lg 12px）。

**ConsolePage**：

- **RunControlBar**：空闲态 = 全局摘要（body-md）+「处理全部」`button-primary` +「停止」`button-secondary`（hairline 描边）；执行态 = 总进度条 + "第 N/M 页 · 页名 · 阶段 · 已用 42s"（caption，muted）。执行条容器用 `surface-soft`（#f8fafc）、rounded-lg。
- **SlideCardGrid**：`demo-grid-card` 规格（rounded-md 10px、白底、hairline 描边、16px 内距、24px gutter，3–4 列响应式）。卡片 = 16:9 缩略图 + 页名（label-md 16/500）+ **阶段轨道**（10 圆点，状态色）+ 当前阶段中文名 + 状态/计时（caption）。失败页：底部错误条显示 `code: message`（signature-coral #aa2d00 作为失败强调色，白字）。
- **TodoQueuePanel**：右侧 240px rail（`topic-filter-rail` 规格），分组标题（caption 大写）+ 计数徽标；组内项 = 页名 + 原因（body-md）；点击跳转。待验收组用 `cream-callout-card`（#f5e9d4、rounded-md、24px 内距）承载强调。
- **ActivityPanel**：底部可折叠抽屉；行 = 时间（caption、muted）+ 内容（body-md）；按日期分隔线（hairline）分组。

**SlidePage**：

- SlideToolbar：返回、页名、上一页/下一页；「运行此页」`button-primary`、从阶段重跑为 `button-secondary` + 菜单；保存按钮 + 脏标记；执行中态内联显示当前阶段+计时。
- StageRail：画布左缘或顶部常驻 10 阶段横向轨道（同卡片轨道视觉，尺寸放大），失败阶段可点开错误详情。
- AcceptFlow：到达 accept-clean 的页进入验收布局——SliderCompare 全幅 + 右侧核查清单卡（`feature-card-tabbed` 规格 surface-soft/rounded-lg/32px）+ 接受（button-primary）/拒绝并重跑（button-secondary）；accept-pptx 同布局换清单内容。
- 侧边栏保留属性/来源/低置信度队列三块（视觉重做：body-md、hairline、rounded-sm 输入 44px 高）。

**状态色约定**（唯一表，全局复用）：completed → success `#006400`；running → info `#254fad`（脉动）；failed/interrupted → signature-coral `#aa2d00`；stale → signature-mustard `#d9a441`；pending → surface-strong `#e0e2e6`。字体按 DESIGN.md 替代方案：macOS 直接 system-ui；display 不加粗（≤500）。

## 4. 数据流（批量执行一轮）

```
用户点「处理全部」→ deck:run-start
→ DeckRunner 入队 N 页 → 逐页：
   stage-start ──→ run-store 更新卡片 live 态 + ticker 计时
   stage-complete → run-store + ActivityLog（含耗时）
   page-done ────→ deck-store 增量刷新该页耐久态；有 gate 则队列面板出现新项
→ run-done → 控制条显示汇总；全程 ActivityLog 落盘
重启后：deck:status-detailed 从 manifest 恢复阶段/错误/耗时；activity:list 恢复流水
```

## 5. 兼容与回滚

- 不改 `packages/core`、`apps/cli`（D3）；main 进程只 import 既有导出函数；workspace 数据与 CLI 双向兼容不变。
- userData jsonl 为纯附加文件，删除不影响任何功能。
- 回滚 = git revert 桌面端 renderer/main 改动；workspace 数据格式无迁移。

## 6. 风险与权衡

| 风险 | 处理 |
|---|---|
| `runSlideRunFrom` 从断点续跑的 `from` 计算与 CLI `deck run`（固定 from ocr）语义不同 | 逐阶段幂等由 manifest fingerprint 保障；断点续跑只会少做不会多做；实现时用真实 deck 验证 |
| validation-failed 态无耐久标记 | 会话内精确分组；重启后降级归入失败组并给出"重新校验"入口 |
| deckStatus + 逐页 loadSlideWorkspace 双次读盘 | 本地 JSON、页数 ≤ 数十，可忽略；不为此改 CLI |
| DESIGN.md 无 error 语义色 | 使用文档内 signature-coral / signature-mustard，不引入新色 |
