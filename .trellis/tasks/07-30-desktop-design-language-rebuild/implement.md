# 执行计划：桌面端设计语言重构

## 验证命令

```bash
# 快速四关（每个检查点都跑）
cd apps/desktop && pnpm typecheck && pnpm test
cd /Users/kelin/Work/ppt-maker && pnpm format:check

# 令牌对比度（改动任一颜色令牌后必跑）
node .trellis/tasks/07-30-desktop-design-language-rebuild/research/palette-contrast.mjs

# 真机走查（CDP，方法见 memory desktop-walkthrough-method）
cd apps/desktop && REMOTE_DEBUGGING_PORT=9222 pnpm dev
```

## 静态断言（对应 PRD 自动可验证项）

```bash
cd apps/desktop/src/renderer

# AC2 品牌签名色不再用于状态
grep -rIo 'signature-' --include='*.tsx' --include='*.ts' . | wc -l          # 期望 0

# AC3 局部按钮常量全部消除
grep -rn 'BUTTON_PRIMARY\s*=\|BUTTON_SECONDARY\s*=\|BUTTON_COMPACT\s*=' .    # 期望无输出

# AC4 焦点可见性（对照：交互元素数 vs focus-visible 数）
grep -rIo 'focus-visible' --include='*.tsx' . | wc -l                        # 期望 >0 且覆盖全部交互组件

# AC5 动效显式时长
grep -rIn 'transition' --include='*.tsx' . | grep -v 'duration-'             # 期望无输出

# 禁用令牌命名
grep -rIn 'paper\|cream\|sand\|parchment\|linen\|ivory' ../../tailwind.config.ts  # 期望无输出
```

---

# 阶段一：令牌 + 基座 + 控制台页

> **交付即停。** 阶段一完成后截真机图交用户验收（PRD AC12），**未获认可不得进入阶段二**。

## 1. 令牌层

- [ ] 1.1 重写 `apps/desktop/tailwind.config.ts` 的 `colors`，落 design.md §2.1 全部 16 个令牌
- [ ] 1.2 **保留旧令牌作为别名**（`signature-*` / `primary` / `muted` / `info` / `success` 等指向新值），避免中途大面积样式塌陷。别名必须在阶段二结束前删净
- [ ] 1.3 加 `fontSize` 固定 rem 尺度（步进比 1.125–1.2）、`transitionDuration` 默认档、`transitionTimingFunction` ease-out 曲线
- [ ] 1.4 `assets/index.css` 加 `@layer base`：全局 `prefers-reduced-motion` 兜底、`tabular-nums` 工具类、默认焦点环重置
- [ ] 1.5 跑对比度脚本确认 22/22 通过

**检查点 A**：`pnpm typecheck` + `pnpm format:check` 通过；应用能启动且不崩（此时视觉仍是旧的，因为别名生效）

## 2. 组件基座

- [ ] 2.1 建 `src/renderer/components/ui/`，写 `Button`（primary / secondary / ghost / danger × sm / md，六态齐全）
- [ ] 2.2 `IconButton`（强制 `aria-label`）
- [ ] 2.3 `StatusDot` + `StatusChip`，实现 design.md §2.2 五态表：完成/待执行走中性实心/空心，进行中/失效/失败各带独立形状与 lucide 图标
- [ ] 2.4 `Panel`（flat / raised / sunken）
- [ ] 2.5 `Field`（input / textarea / checkbox 统一边框与焦点）
- [ ] 2.6 为基座组件补单元测试：变体类名产出、`aria-label` 必填、disabled 时不触发 onClick

**检查点 B**：基座组件测试通过；四关全绿

## 3. 状态表切换

- [ ] 3.1 `lib/stage-view.ts` 的 `STAGE_DOT_CLASS` 换成新语义表。**`blockingStageView` / `currentStageView` / `deriveStageViews` 三个判据函数一律不动**
- [ ] 3.2 `StageTrack` 改用 `StatusDot`
- [ ] 3.3 确认 `stage-view` 既有测试仍全绿（判据未改，测试不应有任何变化）

**检查点 C**：`pnpm test` 全绿，且 `stage-view` 相关用例零改动

## 4. 控制台页重做

- [ ] 4.1 `TopNav` 迁到基座 `Button`，删除本文件的 `BUTTON_PRIMARY` / `BUTTON_SECONDARY`；修正信息层级（品牌名弱化、路径降级为 title 提示，不占第二显眼位）
- [ ] 4.2 `RunControlBar` 迁基座，删本地常量
- [ ] 4.3 `SlideCard` 重做：缩略图缩小、状态置固定角位保证远距离可识别、去掉与状态点重复的文案
- [ ] 4.4 `SlideCardGrid` 提高密度，目标一屏 ≥12 张
- [ ] 4.5 **筛选**：`ConsolePage` 接 `flattenTodoQueue` 得到待处理集合；「全部 N / 待处理 M」切换**常驻可见**；状态存 `ui-store` 会话级。严格遵守 design.md §4.2——筛选只影响列表渲染，不动任何判据与键盘遍历口径
- [ ] 4.6 `TodoQueuePanel` 空态不再占固定宽度
- [ ] 4.7 `DoctorChip` 常态去饱和（「环境正常」不该用饱和绿抢视线）
- [ ] 4.8 修正顶部「已完成 2」与底部活动日志「完成 0」的口径混淆：文案上明确区分 deck 累计状态与本次 run 结果
- [ ] 4.9 `ActivityPanel` / `DeckEmptyState` / `WorkspaceMenu` / `DoctorNoticeBar` 迁基座

**检查点 D**：四关全绿 + 静态断言中 AC3（控制台侧）、AC4、AC5 通过

## 5. 阶段一真机走查

- [ ] 5.1 造多页走查工作区：复制 `~/test/ppttest-walkthrough-E2`，批量复制页目录改 `slideId` / `pageLabel` 至 ~40 页。**不跑流水线**，零 gpt-image-2 调用
- [ ] 5.2 CDP 截控制台页（40 页规模），核对 AC10 状态远距离可识别、能快速定位待处理页
- [ ] 5.3 灰度截图核对 AC9：五种状态仍可彼此区分
- [ ] 5.4 键盘走查：Tab 遍历控制台，全程焦点可见（AC8 控制台部分）
- [ ] 5.5 开启系统「减弱动态效果」复测（AC11）
- [ ] 5.6 截图归档至 `research/after-stage1/`

**🚪 用户验收门（AC12）**：提交对比截图，等待用户明确认可。**未认可不得进入阶段二。**

---

# 阶段二：复核页 + 最终确认页

> 仅在阶段一通过 AC12 后启动。

## 6. 阶段轨道折叠

- [ ] 6.1 `StageRail` 实现收起/展开两态，收起态 ~32px（design.md §5）
- [ ] 6.2 展开状态存 `ui-store` 会话级
- [ ] 6.3 收起态异常阶段直接用形状+颜色标在进度条上

## 7. 复核页

- [ ] 7.1 `ReviewPage` 迁基座
- [ ] 7.2 `BlockListPanel`（565 行，最大文件）迁基座；OCR/AI 双源对照改善可读性，diff 用 `proof-wash` 底 + `proof` 字
- [ ] 7.3 `TextDiffRow` / `ClassificationRow` / `BlockTextEditor` 迁基座
- [ ] 7.4 修正「已复核」绿点与「文字待确认」标签语义打架（同一行同时出现两个矛盾判断）
- [ ] 7.5 筛选区计数排布重做：四个计数 + 「全部 60」+ 右侧「60 项」当前重复且不对齐
- [ ] 7.6 `ReviewShortcutBar` 改为按需唤起（释放 110px 常驻空间）
- [ ] 7.7 `ReviewCanvas` / `TextBlockOverlay` 迁基座；缩放提示不再压住内容左下角

## 8. 最终确认页

- [ ] 8.1 `FinalConfirmPage` 迁基座，删本地按钮常量
- [ ] 8.2 **修复文字溢出截断缺陷**（基线截图实证：「且会再花一次付费调」被容器切断）
- [ ] 8.3 三个动作统一为一致的按钮词汇（当前是实心按钮 / 描边按钮 / 蓝色文字链接三种形式）
- [ ] 8.4 右栏信息层级重建：当前「本页已验收」到底部结论全是同一字号档
- [ ] 8.5 结论（「已完成最终确认」）上移，不需滚动即可见
- [ ] 8.6 `CheckSummary` / `CompositePreview` / `SliderCompare` 迁基座。**保留 07-30 修的 sticky 操作区与折叠行为**，不得回退

## 9. 收尾

- [ ] 9.1 删除 tailwind 配置中的全部旧令牌别名
- [ ] 9.2 全量静态断言：AC2 / AC3 / AC4 / AC5 全部通过
- [ ] 9.3 重写根 `DESIGN.md`（R6），front-matter 的 `Airtable-design-analysis` 必须消失
- [ ] 9.4 全链路真机走查：AC7 三页一致无混搭、AC8 全键盘走完打开→复核→确认、AC11 减弱动效
- [ ] 9.5 截图归档 `research/after-stage2/`
- [ ] 9.6 四关全绿

## 回滚点

| 回滚到 | 命令 | 影响 |
|---|---|---|
| 检查点 A 前 | 恢复 `tailwind.config.ts` + `index.css` | 全部回到旧视觉 |
| 检查点 D 前 | 保留令牌与基座，回退控制台页组件 | 基座可留待后用 |
| 阶段一后 | 阶段二逐页提交，可单页回退 | 复核页与确认页互不影响 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 令牌重命名 touch 24 个文件导致大面积塌陷 | 步骤 1.2 保留别名，逐页迁移，最后统一删除 |
| 改到判据逻辑，把 M4 已修缺陷重新打开 | 判据函数列入不可改清单（design.md §1）；`stage-view` / `todo-queue` / `accept-gate` 既有测试零改动作为硬信号 |
| 筛选导致「打开已完成页」能力消失 | design.md §4.2 三条硬约束；切换常驻可见 |
| store 订阅方式被改成返回对象，引发全网格重渲染 | 逐字段订阅写法列入不可改清单；重构时保留原注释 |
| 真机走查烧钱 | 只用 E2 副本与合成多页工作区，绝不碰 `~/test/ppttest-walkthrough-E1`；执行态用 `useRunStore.setState` 模拟 |
