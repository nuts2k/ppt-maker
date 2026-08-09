# M5/M6 前端界面设计修复 — 执行计划

## 执行顺序

按回滚点分 6 步，每步独立提交。顺序按风险从低到高排列——
先改纯文本/class 的低风险项，再改结构。

## T1: R1 side-stripe → proof-wash 背景

- [ ] 打开 `PlanningPage.tsx` 的 `HistoryField` 函数（约 :2114–:2134）
- [ ] before `<p>`：`border-l-2 border-hairline pl-2` → `rounded-sm bg-surface-sunken px-2 py-1`
- [ ] after `<p>`：`border-l-2 border-proof pl-2` → `rounded-sm bg-proof-wash px-2 py-1`
- [ ] 保留 `text-ink-muted`（before）和 `text-ink`（after）文字色

验证：`pnpm typecheck`

## T2: R4 对比度修复

- [ ] `SourceReviewPage.tsx`：全文搜索 `text-ink-muted`，仅改在 `bg-surface-sunken` / `Panel elevation="sunken"` 上下文内的实例为 `text-ink-secondary`
  - :486/:490/:505 大图区域
  - :54/:691 缩略图区域（注意仅改占位文案，不改 `bg-canvas` 上下文的实例）
- [ ] `SourcePicker.tsx`：:627/:640/:643 初稿列表区域
- [ ] `PlanningPage.tsx`：:1688/:1693/:1696 用户消息气泡内的 header 和时间

验证：逐个确认改动只在 sunken 上下文内

## T3: R6 次要修复

- [ ] `TopNav.tsx:130`：删掉 `uppercase tracking-wide`
- [ ] `PlanningPage.tsx`：搜索 `tracking-wide`，逐处删掉（约 :1847、:1959）
- [ ] `SourceReviewPage.tsx` ThumbnailTile：选中项 hover 从 `border-border-strong` 改为 `border-border-strong hover:border-border-strong`
- [ ] `PlanningPage.tsx`：搜索动态数字（`{index + 1}`、`{n} 个`、`{...length}` 等），给包含它们的元素加 `tabular-nums`
- [ ] `SourceReviewPage.tsx` 的 busyReason：在 disabled 按钮旁加可见文案 `<p>`
- [ ] `PlanningPage.tsx` SpecImpactPanel 区域：disabled reason 从 title-only 改为可见文案

验证：`pnpm typecheck`

## T4: R3 SourceReview 付费确认可见化

- [ ] `SourceReviewPage.tsx` 的 regenClusterRef 区域（约 :562–:596）
- [ ] 在 armed 条件块内、Button 后方添加可见费用提示：
  ```tsx
  {armed && (
    <p className="shrink-0 text-xs text-proof">
      将调用图像生成（按次付费）
    </p>
  )}
  ```
- [ ] 保留 title 作为补充信道，不删除

验证：`pnpm typecheck`

## T5: R5 IconButton loading

- [ ] `IconButton.tsx`：加 `loading?: boolean` prop
- [ ] loading 为 true 时：children 替换为旋转 Loader 图标（与 Button.tsx 一致），按钮 disabled
- [ ] `MenuItem.tsx`、`Field.tsx`、`Segmented.tsx`：在组件顶部加注释说明 loading/active 不适用的原因

验证：`pnpm typecheck` + 确认现有 IconButton 调用点不受影响

## T6: R2 EntryEditor 折叠 + SpecImpactPanel 降级

这是结构变化最大的一步，放在最后。

### EntryEditor 折叠

- [ ] `EntryEditor` 的 `selected === false` 时，pageType 行以下的内容块用 `{selected && (...)}` 包裹
- [ ] 折叠态在 header 行下方加一行摘要：
  ```tsx
  {!selected && (
    <p className="mt-1 truncate text-xs text-ink-muted">
      {entry.pageType || "未设页型"} · {entry.textGroups.length} 组文字
    </p>
  )}
  ```
- [ ] 确认 `onFocus={onSelect}` 仍在 Panel 上，聚焦即展开

### SpecImpactPanel 降级

- [ ] 在 `SpecImpactPanel` 渲染条件外包一层 `hasSpecImpact(...)` 判断
- [ ] 无影响时完全不渲染（删掉空文案展示）
- [ ] 有影响时在 SpecEditor 和 SpecImpactPanel 之间加分隔：
  ```tsx
  <div className="border-t border-hairline pt-6">
    <h2 className="mb-4 text-lg font-semibold text-ink">下一步</h2>
    <SpecImpactPanel ... />
  </div>
  ```

验证：`pnpm typecheck` + `pnpm test`

## 最终验证

- [ ] `pnpm format:check` — 格式检查
- [ ] `pnpm typecheck` — 类型检查
- [ ] `pnpm test` — 全量测试（基线 1000）
- [ ] `pnpm build` — 构建
- [ ] 四关全绿后，检查 KNOWN-ISSUES.md 是否有条目因本次修复而可删
