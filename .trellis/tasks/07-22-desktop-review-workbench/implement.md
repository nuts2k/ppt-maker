# M4 桌面复核工作台 V2 — 实施计划

> V2 重构版实施计划（V1 计划已作废）。顺序执行，每步完成后跑对应验证再进入下一步。画布内核（ReviewCanvas / TextBlockOverlay / TextBlockHandle / TextEditor / SliderCompare / useCanvasTransform）**不改动交互逻辑**，仅允许样式 token 调整。

## 阶段 A：main 进程执行层（UI 无关，可独立验证）

- [ ] A1 `src/main/activity-log.ts`：按 deckId 追加写 userData jsonl；`activity:list` IPC；单元可测（纯函数 + fs）
- [ ] A2 `src/main/runner/deck-runner.ts`：串行队列、断点续跑 from 计算、stop 语义、DeckRunEvent 广播、事件同步写 ActivityLog
- [ ] A3 `src/main/ipc/deck.ts`：新增 `deck:run-start` / `deck:run-stop` / `deck:status-detailed`（stages + lastError + stageDurations 聚合自 manifest attempts）
- [ ] A4 `src/main/ipc/slide.ts`：移除 `slide:run`；accept-clean / accept-pptx / export handler 追加 ActivityLog 记录
- [ ] A5 `src/main/ipc/channels.ts` + preload：类型与桥接同步更新

验证：`pnpm typecheck`；dev 模式对真实 deck 触发 run-start，观察事件序列与 jsonl 落盘。

## 阶段 B：renderer 状态层

- [ ] B1 删除 `pipeline-store`；新建 `run-store`（订阅 deck:run-progress，1s ticker 计时）
- [ ] B2 `deck-store` 改造：status-detailed 数据结构；page-done 增量刷新
- [ ] B3 新建 `activity-store`；`ui-store` 路由与队列面板态
- [ ] B4 待办队列派生 selector（耐久层 + 会话层合并，见 design.md 3.2）

验证：`pnpm typecheck`；store 单测（队列派生逻辑必测：failed/stale/待验收 clean/待验收 pptx 四组）。

## 阶段 C：控制台（ConsolePage）

- [ ] C1 AppShell / top-nav 重做（DESIGN.md top-nav 规格 + 导出主按钮 + doctor chip）
- [ ] C2 RunControlBar：空闲摘要态 + 执行进度态 + 停止控制
- [ ] C3 SlideCard 重做：阶段轨道 10 点 + 当前阶段中文名 + 计时 + 失败错误条；SlideCardGrid 布局
- [ ] C4 TodoQueuePanel：四组分组、计数、点击直达
- [ ] C5 ActivityPanel：折叠抽屉、日期分组
- [ ] C6 空态（未打开 deck）与创建/打开流程衔接

验证：dev 模式真实 deck 全流程走查——打开、批量执行、卡片实时推进、停止、失败展示、重启后状态恢复。

## 阶段 D：单页复核（SlidePage 壳层重写）

- [ ] D1 SlideToolbar：运行此页 / 从阶段重跑菜单 / 保存与脏标记 / 页间导航
- [ ] D2 StageRail 常驻 + 失败阶段错误详情
- [ ] D3 AcceptFlow：accept-clean（SliderCompare + 清单 + 接受/拒绝重跑）、accept-pptx（清单 + 确认）
- [ ] D4 侧边栏三块视觉重做（属性 / 来源 / 低置信度队列），画布内核接入回归
- [ ] D5 队列"处理下一项"导航闭环

验证：画布全部 V1 交互回归（选中/双击编辑/拖拽/右键分类/includeInMask/缩放平移）；验收记录写入 manifest 后用 CLI `deck status` 核对。

## 阶段 E：收尾

- [ ] E1 doctor 启动提示 + 导出前警告
- [ ] E2 DESIGN.md 合规走查（对照 token 表逐组件核对；无 hover 新增样式；display ≤ 500 weight）
- [ ] E3 全量验证：`pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
- [ ] E4 真实 deck 端到端：创建 → 批量 → 逐页验收 → 导出 → PowerPoint 打开确认

## 回滚点

- 阶段 A 完成即 commit（main 层独立可回滚）；C、D 各自完成后 commit。
- 风险文件：`ipc/channels.ts`（类型契约中枢）、`deck-store`（多处消费）。改动前先全仓 grep 消费点。

## 遗留清理

- [ ] 移除 `slide:run` 通道后确认 renderer 无残留调用
- [ ] 删除 pipeline-store 及其引用
- [ ] `out/` 构建产物按现有仓库习惯处理（当前被 git 跟踪，保持现状，不在本任务内改变策略）
