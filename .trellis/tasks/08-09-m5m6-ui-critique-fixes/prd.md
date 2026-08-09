# M5/M6 前端界面设计修复

## Goal

修复 Impeccable critique（2026-08-09，28/40）发现的 3 个 P1 和 2 个 P2 问题，
使 M5（页面来源）与 M6（内容策划工作台）新增的前端界面符合 DESIGN.md 规范。

评审快照：`.impeccable/critique/2026-08-09T07-43-09Z__apps-desktop-src-renderer.md`

## 背景决策

- **PlanningPage 定位**：对话与编辑器保持等权（用户决策），但需要在交互上更好地分离工作模式。
- **不升版本、不改契约**：本任务只改 renderer 侧代码，不动 core/CLI。

## Requirements

### R1 [P1] 修复 side-stripe absolute ban 违规

`PlanningPage.tsx:2126`/`:2129` 的 `border-l-2 border-hairline`/`border-l-2 border-proof`
用于 history diff before/after。彩色左侧边条是 DESIGN.md 和 Impeccable 均明令禁止的。

改为以下任一方案：
- 完整 1px border + `bg-proof-wash` 底色区分 after
- 双列 before/after 并排
- 内联 `前/后` 标签 + 文字权重

### R2 [P1] PlanningPage 工作模式分离

当前同屏承载对话/历史、材料、五维收敛、composer、规格编辑器、规格影响面板、
建页/重生成、提案 review，`primaryAction` 在多个区域竞争。

要求：
- 全屏 primary 在任一时刻只有一个可见候选
- Impact panel 从等权面板降为保存后/有影响时的"下一步"区块
- EntryEditor 默认折叠非当前编辑条目，点击展开
- 对话区与编辑区在视觉上明确谁是当前焦点（不改等权关系，但减少同时竞争）

### R3 [P1] 统一付费生成动作的确认可见性

三处付费确认的现状不一致：
- SourcePicker：系统确认框（`dialog.showMessageBox`），最强
- SourceReviewPage：二次点击 + `title`，键盘用户不可见
- PlanningPage SpecImpactPanel：另一套确认

要求：
- SourceReviewPage armed 态下在按钮旁显示可见费用文案（非 title）
- 三处确认的信息密度应有层级但视觉语义一致

### R4 [P2] 修复 ink-muted on surface-sunken 对比度（4 处）

`ink-muted`（#6c6c6c）在 `surface-sunken`（#ededed）上约 4.49:1，不达 WCAG AA 4.5:1。

出现位置：
- `SourceReviewPage.tsx:486`/`:490`/`:505` — 大图加载/失败文案
- `SourceReviewPage.tsx:54`/`:691` — 缩略图占位文案
- `SourcePicker.tsx:627`/`:640`/`:643` — 初稿列表
- `PlanningPage.tsx:1688`/`:1693`/`:1696` — 用户消息气泡时间戳

修复方案：`surface-sunken` 上的 `text-ink-muted` 一律改为 `text-ink-secondary`。

### R5 [P2] 交互基座六态补齐

DESIGN.md 要求每个交互组件交付 default/hover/focus-visible/active/disabled/loading 六态。

Button 已完整。以下组件需逐个评估并补齐或显式标注"不适用"：
- IconButton：缺 loading
- MenuItem：缺 loading/active
- Field：缺 loading/error 可见表达
- Segmented：缺 loading

### R6 [P2-P3] 次要修复

- 收敛 `TopNav.tsx:130` 和 `PlanningPage.tsx:1847`/`:1959` 的 `tracking-wide` eyebrow 余味
- 修复 SourceReviewPage 缩略图选中项 hover 反馈倒退（:678-681）
- 补齐遗漏的 `tabular-nums` 覆盖（PlanningPage 计数类文案）
- 多个 disabled reason 从 `title` 改为可见文案（SourceReviewPage busyReason、SpecImpactPanel 禁用说明）

## Out of Scope

- PlanningPage 策划模式定位变更（保持等权）
- core/CLI 改动
- NoticeBar 全局统一（范围过大，另开任务）
- SourcePicker stepper 化改造
- EntryEditor 删除 undo（需要状态管理变更，另开任务）
- 暗色主题

## Acceptance Criteria

- [ ] A1: PlanningPage history diff 不使用 `border-l-2` side stripe
- [ ] A2: PlanningPage 全屏 primary 按钮在任一时刻只有一个可见
- [ ] A3: EntryEditor 默认折叠非当前条目
- [ ] A4: SourceReviewPage armed 态有可见费用文案（非 title）
- [ ] A5: 4 处 `ink-muted` on `surface-sunken` 已改为 `ink-secondary`，对比度 ≥4.5:1
- [ ] A6: IconButton/MenuItem/Field/Segmented 的缺失状态已补齐或标注不适用
- [ ] A7: `tracking-wide` eyebrow 已收敛
- [ ] A8: 缩略图选中项 hover 不倒退
- [ ] A9: PlanningPage 计数文案有 `tabular-nums`
- [ ] A10: 关键 disabled reason 有可见文案替代 title
- [ ] A11: `pnpm typecheck` / `pnpm test` / `pnpm format:check` / `pnpm build` 四关全绿
- [ ] A12: 重跑 Impeccable critique 分数 ≥ 30（当前 28）
