# M5/M6 前端界面设计修复 — 技术设计

## 概述

本文件描述 PRD R1–R6 的技术方案。所有改动限于 `apps/desktop/src/renderer/`，
不动 core/CLI。

## 1. HistoryField side-stripe → proof-wash 背景（R1）

**现状**：`PlanningPage.tsx` 的 `HistoryField` 组件用 `border-l-2 border-hairline` /
`border-l-2 border-proof` 区分 before/after。

**方案**：删掉 `border-l-2`，改为背景色 + 内联标签区分。

```
before: bg-surface-sunken, 前缀文字 "前："
after:  bg-proof-wash, 前缀文字 "后："
```

两条 `<p>` 都改为 `rounded-sm px-2 py-1`，去掉 `pl-2`。保留 `text-ink-muted`（before）
和 `text-ink`（after）的文字色对比。

涉及文件：`PlanningPage.tsx` 的 `HistoryField` 函数（约 2114–2134 行），约 4 行改动。

## 2. PlanningPage 工作模式分离（R2）

**现状分析**：

主区域 `<main>` 的内容由状态决定：
- 有 pendingProposal → `ProposalReview`
- 否则 loading → 加载文案
- 否则 editable === null → `EmptySpec`
- 否则 → `SpecEditor` + `SpecImpactPanel`（竖排在同一个滚动区）

竞争 primary 的位置：
- header 的「保存规格」（`primaryAction === "save"` 时为 primary）
- sidebar composer 的「发送/生成改稿提案」（`primaryAction === "send"` 时为 primary）
- SpecImpactPanel 的「建立所选 N 页」和「重新生成 N 页」

**方案**：三个层面的收敛，不拆页面、不改等权关系。

### 2a. EntryEditor 默认折叠

当前 `EntryEditor` 始终展开所有字段。改为：
- 折叠态（`selected === false`）：只显示 header 行（页面序号 + specEntryId + 「设为对话目标」按钮 + 移动/删除按钮）
- 展开态（`selected === true`）：显示全部字段（pageType、textGroups、visualIntent、revisionNotes）

实现：在 `EntryEditor` 的 `return` 中，把 pageType 以下的内容块包在
`{selected && (...)}` 条件渲染里。折叠态的 header 行已有。

点击 header 行的「设为对话目标」或 `onFocus` 触发展开，与当前行为一致。

额外：折叠态显示一行摘要（pageType + 文字组数），给用户不展开就能扫的信息。

### 2b. SpecImpactPanel 降级为"下一步"区块

当前 `SpecImpactPanel` 与 `SpecEditor` 在同一个 `flex-col gap-6` 里等权排列。

改为：
- `SpecImpactPanel` 只在有影响时（`hasSpecImpact` 为 true）才渲染
- 渲染位置不变（编辑器下方），但加分隔标题「下一步」
- 无影响时完全不占位（当前的 `specImpactEmptyCopy` 空文案也不显示）

这让用户在编辑规格时看到的是纯编辑区；保存后如果产生影响，下方才出现行动区。

### 2c. 全屏 primary 仲裁

当前 `resolvePlanningPrimaryAction` 已在 header save 和 sidebar send 之间做二选一。
问题是 SpecImpactPanel 的按钮与 header/sidebar 的 primary 不互斥。

方案：SpecImpactPanel 的「建立所选 N 页」和「重新生成 N 页」保持 `variant="secondary"`，
不抢 primary。只有 header save 和 sidebar send 参与 primary 仲裁，保持现有逻辑。
（这已经是现状——两个按钮都是 secondary，不需要改动，只需确认不会被后续改动升级。）

## 3. SourceReviewPage 付费确认可见化（R3）

**现状**：armed 态按钮变成 `variant="danger"`，文案从「重新生成」变成「确认重新生成？」，
付费说明只在 `title` 里。

**方案**：armed 态在按钮下方（`regenClusterRef` 内）添加一行可见文案：

```tsx
{armed && (
  <p className="text-xs text-proof">
    将调用图像生成（按次付费）；Esc 或移开焦点取消
  </p>
)}
```

放在 `regenClusterRef` 的 `<div>` 里、与 Textarea 和 Button 同级。
不改二次点击机制本身（高频动作，弹框会毁效率，这是刻意设计）。

涉及文件：`SourceReviewPage.tsx:562–596`，约 5 行新增。

## 4. ink-muted on surface-sunken 对比度修复（R4）

**规则**：`surface-sunken`（#ededed）上的文字从 `text-ink-muted` 改为 `text-ink-secondary`。

四处改动（行号为当前 HEAD，改动可能使行号偏移）：

| 文件 | 位置 | 改动 |
|---|---|---|
| `SourceReviewPage.tsx` | :486/:490/:505 大图加载/失败文案 | `text-ink-muted` → `text-ink-secondary` |
| `SourceReviewPage.tsx` | :54/:691 缩略图占位 | `text-ink-muted` → `text-ink-secondary` |
| `SourcePicker.tsx` | :627/:640/:643 初稿列表 | `text-ink-muted` → `text-ink-secondary` |
| `PlanningPage.tsx` | :1693/:1696 消息气泡 header/时间 | `text-ink-muted` → `text-ink-secondary` |

注意：只改 `surface-sunken` 上下文的实例。`canvas` 上的 `text-ink-muted` 不改
（#6c6c6c on #ffffff = 5.28:1，达标）。

## 5. 交互基座六态评估（R5）

逐组件决策：

| 组件 | 缺失 | 决策 |
|---|---|---|
| `IconButton` | loading | 补 `loading` prop，与 Button 一致（spinner 替换 children） |
| `MenuItem` | loading/active | 标注不适用：MenuItem 是菜单项，不 loading；active 由 `selected` 替代 |
| `Field` | loading/error 可见表达 | 标注不适用：Field 是 wrapper，loading/error 由内部 Input/Textarea 承载 |
| `Segmented` | loading | 标注不适用：Segmented 是选择器，不 loading |

只需实际补代码的：**IconButton 加 loading**。其余在组件文件顶部加注释说明不适用原因。

## 6. 次要修复（R6）

### 6a. tracking-wide eyebrow 收敛

- `TopNav.tsx:130`：`uppercase tracking-wide` → 去掉 `uppercase tracking-wide`，保持 `text-2xs font-semibold`
- `PlanningPage.tsx:1847`：`text-2xs font-semibold tracking-wide text-proof` → 去掉 `tracking-wide`
- `PlanningPage.tsx:1959`：同上模式，去掉 `tracking-wide`

### 6b. 缩略图 hover 反馈倒退

`SourceReviewPage.tsx` 的 `ThumbnailTile`（约 :678）：

现状：`selected ? "border-border-strong" : "border-transparent hover:border-border"`

修复：`selected ? "border-border-strong hover:border-border-strong" : "border-transparent hover:border-border"`

即：选中项 hover 时保持 `border-strong`，不回退。

### 6c. tabular-nums 补齐

PlanningPage 中需要加 `tabular-nums` 的位置：
- `:858` 的 `页面 {index + 1}` — 在其 className 加 `tabular-nums`
- `:1902-1904` 的 `{n} 个字段变化` 等 — 在其 className 加 `tabular-nums`
- 搜索 PlanningPage 中所有包含动态数字的 `<span>` / `<p>`，逐个检查

### 6d. disabled reason 可见化

关键位置：
- `SourceReviewPage.tsx` 的 busyReason：接受/重新生成按钮的 `title`
  → 按钮下方或旁边加一行 `<p className="text-xs text-ink-muted">{busyReason}</p>`
- `SpecImpactPanel` 的建页/重生成禁用说明：从 title 改为按钮下方文案

原则：`disabled` 按钮通常不可聚焦，`title` 对键盘用户不可靠。
用内联文案替代 title，保留 title 作为补充（非唯一信道）。

## 回滚点

每个 R 独立提交，便于逐个回退：

1. R1 side-stripe → 独立提交
2. R2 EntryEditor 折叠 + SpecImpactPanel 降级 → 独立提交
3. R3 SourceReview 付费文案 → 独立提交
4. R4 对比度修复 → 独立提交
5. R5 IconButton loading → 独立提交
6. R6 次要修复合并一个提交

## 不改的

- `SpecImpactPanel` 的建页/重生成按钮已经是 `secondary`，不需要改 variant
- NoticeBar 全局统一（Out of Scope）
- EntryEditor 删除 undo（Out of Scope）
- 对话 vs 编辑器等权关系（用户决策保持现状）
