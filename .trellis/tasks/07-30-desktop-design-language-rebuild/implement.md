# 执行计划：桌面端设计语言重构

---

# ⚑ 交接状态（2026-07-31）

**阶段一已完成并提交，阶段二未开始。**

## 当前所在分支

`design/desktop-language-rebuild`（从 `main` 切出，**未推远端**）。六个提交：

```
8e56216 chore(task): 记录规划与走查产物
1cfbb72 feat(desktop): 控制台按 20–50 页重做，新增待处理筛选
dc95f8d refactor(desktop): 状态语义改为「有颜色 = 要你管」，完成态归中性
f93bf08 feat(desktop): 新增 components/ui 组件基座，六态齐全
2ff2920 feat(desktop): 重做设计令牌与基础层，中性阶 chroma 归零
642698f docs: 建立 PRODUCT.md 并把 DESIGN.md 重写为「校样台」设计语言
```

## ⚠ 开工前必须先确认的一件事

**PRD AC12 是硬门禁，用户尚未给出认可。** 用户在阶段一结束时选择的是「先提交保存，我自己跑一遍再说」，
不是「认可，推阶段二」。

所以新会话**不得直接开始阶段二**，必须先问用户跑下来的结论：

- 认可 → 按下方阶段二清单推进；
- 有要调整的 → 先改阶段一，重新截图交验，通过后再推阶段二。

## 阶段二开工前应读

1. 根目录 `PRODUCT.md`（战略：register、反参考、五条设计原则、无障碍四条）
2. 根目录 `DESIGN.md`（视觉契约，已重写为「校样台」）
3. 本任务 `design.md` §1 的**不可改清单**与 §5 阶段轨道折叠方案
4. `.trellis/spec/frontend/state-management.md`（判据兼职、同源判据两条教训）
5. `research/after-stage1/` 走查证据与可复跑脚本

## 已确定、不要再问的决策

| 决策 | 结论 |
|---|---|
| 控制台默认筛选 | **保持「待处理」**（用户 2026-07-31 二次确认） |
| 暗色主题 | 不做，非本任务范围 |
| 完成态用色 | 中性，**不许改回绿色**（`test/ui-design-rules.test.ts` 会拦） |
| Impeccable 技能升级 | 用户选择暂不升级 |

## 阶段一相对原计划的偏差（已生效，勿回退）

1. **DESIGN.md 重写从收尾提前到了第 2 步**。CLAUDE.md 要求「实现前端代码前必须先读取 DESIGN.md」，
   让契约滞后到最后等于整个重构期都在对着过期契约写代码。原步骤 9.3 因此已完成。
2. **测试策略改为锁设计规则而非渲染快照**。项目刻意不装 DOM 测试库、测试只导入纯 `.ts`
   （`tsconfig.node.json` 覆盖 `test/` 且不含 `@/*` 映射）。因此变体表与状态表抽成
   `components/ui/variants.ts` 与 `status-spec.ts` 两个纯模块并用**相对 `.js` 导入**，
   新增 `test/ui-design-rules.test.ts` 锁住「完成态不许用饱和色」等规则。
   **新写可测模块时务必沿用相对 `.js` 导入**，用 `@/` 别名会直接失去类型。
3. **对比度令牌从 22 项增至 26 项**：补了 `ink-hover` 与 `proof-hover`
   （近黑按钮的 hover 应当变亮、按压才变暗）。`proof-hover` 白字 4.81:1 偏紧，**不要再提亮**。
4. **`biome.json` 开启了 `css.parser.tailwindDirectives`**，减弱动效兜底的 `!important`
   带局部豁免注释。biome 给的「修复」是删掉它，那会让 AC11 失效，**不要接受该自动修复**。
5. **`.gitignore` 新增 `/.impeccable/hook.cache.json`**（本机缓存），`live/config.json` 需入库。

## 阶段一遗留、阶段二要处理

- **迁移期旧令牌别名仍在 `tailwind.config.ts` 里**，以下 11 个文件仍在用，阶段二结束前必须删净
  （PRD AC2 会验）：

  ```
  components/compare/SliderCompare.tsx      components/review/ReviewShortcutBar.tsx
  components/final/CheckSummary.tsx         components/review/TextDiffRow.tsx
  components/final/CompositePreview.tsx     components/slide/SlideToolbar.tsx
  components/review/BlockListPanel.tsx      components/slide/StageRail.tsx
  components/review/ClassificationRow.tsx   pages/FinalConfirmPage.tsx
                                            pages/ReviewPage.tsx
  ```

- **活动日志文案口径未统一，且刻意没改**：`执行结束：完成 N，待人工 M` 这句同时由主进程
  `src/main/runner/deck-runner.ts:192` 写入持久化 jsonl。只改渲染层会让实时显示与重启后
  从日志读出的内容不一致。控制条一侧已加「Deck 累计：」前缀消歧。**要彻底统一得两边一起改，
  属于渲染层之外的改动，需先向用户确认。**

## 真机走查踩过的两个坑（会把结论测反）

1. **`Emulation.setEmulatedMedia` 只在设置它的 CDP 会话内有效**。设置与查询必须同一个 WebSocket
   会话内完成，否则「A 脚本设减弱动效 → B 脚本查样式」必然读到未模拟状态。
   可复跑脚本见 `research/after-stage1/reduce-check.mjs`。
2. **`await import('/stores/xxx.ts')` 拿到的可能不是应用那份模块实例**。用它 `setState` 会出现
   「store 值已改、界面纹丝不动」，看着像响应式 bug，实为脚手架假象。
   **验证交互一律用 `Input.dispatchMouseEvent` 真实点击。**

---

## 验证命令

```bash
# 快速四关（每个检查点都跑）
cd apps/desktop && pnpm typecheck && pnpm test
cd /Users/kelin/Work/ppt-maker && pnpm format:check   # 注意 format:check 是根脚本

# 令牌对比度（改动任一颜色令牌后必跑，26 项须全过）
node .trellis/tasks/07-30-desktop-design-language-rebuild/research/palette-contrast.mjs

# 真机走查：先起服务，再用 research/after-stage1/ 下的脚本
cd apps/desktop && REMOTE_DEBUGGING_PORT=9222 pnpm dev
```

## 静态断言（对应 PRD 自动可验证项）

```bash
cd apps/desktop/src/renderer

grep -rIo 'signature-' --include='*.tsx' --include='*.ts' . | wc -l          # AC2 期望 0
grep -rn 'BUTTON_PRIMARY\s*=\|BUTTON_SECONDARY\s*=\|BUTTON_COMPACT\s*=' .    # AC3 期望无输出
grep -rIn 'transition' --include='*.tsx' . | grep -v 'duration-'             # AC5 期望无输出
grep -rIn 'paper\|cream\|sand\|parchment\|linen\|ivory' ../../tailwind.config.ts  # 期望无输出
```

---

# 阶段一：令牌 + 基座 + 控制台页 ✅ 已完成（2026-07-31）

> 交付结果：typecheck ✓ / **311 测试全绿** / format ✓；对比度 26 项全过；
> 真机实测 AC8 焦点无遗漏、AC9 灰度五态可分辨、AC10 一屏 15 张（目标 ≥12）、
> AC11 动效 73→0 且执行中脉冲降级为静态光环。零 gpt-image-2 调用。

## 1. 令牌层 ✅

- [x] 1.1 `tailwind.config.ts` 落 16 个新令牌
- [x] 1.2 保留旧令牌别名（**阶段二结束前删净**）
- [x] 1.3 字号尺度 + 动效时长 + ease-out 曲线
- [x] 1.4 `index.css` 全局 `:focus-visible` + `prefers-reduced-motion` 兜底 + `tabular-nums`
- [x] 1.5 对比度脚本通过（22 → 实际 26 项，见偏差 3）

## 2. 组件基座 ✅

- [x] 2.1–2.5 `Button` / `IconButton` / `StatusDot` / `StatusChip` / `Panel` / `Input` / `Textarea` / `Checkbox`
- [x] 2.6 单元测试 → 改为 `test/ui-design-rules.test.ts` 锁设计规则（见偏差 2）

## 3. 状态表切换 ✅

- [x] 3.1 `STAGE_DOT_CLASS` 删除，视觉映射迁至 `components/ui/status-spec.ts`；判据函数零改动
- [x] 3.2 `StageTrack` 改用 `StatusDot`
- [x] 3.3 `stage-view.test.ts` 19 例**测试文件零改动**即全绿 ← 判据未被动的硬信号

## 4. 控制台页重做 ✅

- [x] 4.1–4.9 全部完成。12 个文件改动，4 份局部按钮常量清零，筛选复用 `deriveTodoQueue`

额外修正（子代理初版的问题，已改）：

- 卡片详情行**按严重度着色**。初版「有待办原因就上校对红」导致真失败渲染成中性灰、
  常规人工门是红色，失败反比日常流程不显眼。
- 导出 PPTX 由 primary 降为 secondary，全屏只留「处理全部」一个主行动。
- 完成/待执行不给卡片角标，否则 40 张卡的角落会被灰点填满 —— 那是 9 个绿点的同一个错误换了颜色。

## 5. 阶段一真机走查 ✅

- [x] 5.1–5.6 完成，证据与可复跑脚本在 `research/after-stage1/`

**🚪 用户验收门（AC12）：尚未获得认可。** 见顶部「开工前必须先确认的一件事」。

---

# 阶段二：复核页 + 最终确认页

> **仅在拿到 AC12 认可后启动。**

## 6. 阶段轨道折叠

- [ ] 6.1 `StageRail` 实现收起/展开两态，收起态 ~32px（design.md §5）。当前它在复核页与
      最终确认页各占 **175px**，而用户此时已在页内作业，9 个点提供的信息价值极低
- [ ] 6.2 展开状态存 `ui-store` 会话级
- [ ] 6.3 收起态异常阶段直接用形状+颜色标在进度条上

## 7. 复核页

- [ ] 7.1 `ReviewPage` 迁基座
- [ ] 7.2 `BlockListPanel`（565 行，全项目最大文件）迁基座；OCR/AI 双源对照改善可读性，
      diff 用 `proof-wash` 底 + `proof` 字
- [ ] 7.3 `TextDiffRow` / `ClassificationRow` / `BlockTextEditor` 迁基座
- [ ] 7.4 修正「已复核」绿点与「文字待确认」标签**语义打架**（同一行同时出现两个矛盾判断）
- [ ] 7.5 筛选区计数排布重做：四个计数 +「全部 60」+ 右侧「60 项」当前重复且不对齐
- [ ] 7.6 `ReviewShortcutBar` 改为按需唤起（释放 110px 常驻空间）
- [ ] 7.7 `ReviewCanvas` / `TextBlockOverlay` 迁基座；缩放提示不再压住内容左下角

> 纵向空间账：复核页顶栏 100 + 工具栏 75 + 阶段轨道 175 + 快捷键条 110 = **37% 不产内容**。
> 6.1 与 7.6 合计可释放约 250px。

## 8. 最终确认页

- [ ] 8.1 `FinalConfirmPage` 迁基座，删本地按钮常量
- [ ] 8.2 **修复文字溢出截断缺陷**（基线截图实证：右栏「且会再花一次付费调」被容器切断）
- [ ] 8.3 三个动作统一按钮词汇（当前是实心按钮 / 描边按钮 / 蓝色文字链接三种形式）
- [ ] 8.4 右栏信息层级重建：当前「本页已验收」到底部结论全是同一字号档
- [ ] 8.5 结论（「已完成最终确认」）上移，不需滚动即可见
- [ ] 8.6 `CheckSummary` / `CompositePreview` / `SliderCompare` 迁基座。
      **保留 07-30 修的 sticky 操作区与折叠行为**，不得回退

## 9. 收尾

- [ ] 9.1 删除 `tailwind.config.ts` 中的全部旧令牌别名（11 个文件迁完后）
- [ ] 9.2 全量静态断言：AC2 / AC3 / AC4 / AC5 全过
- [x] ~~9.3 重写根 `DESIGN.md`~~ —— 已在阶段一完成（见偏差 1）
- [ ] 9.4 全链路真机走查：AC7 三页一致无混搭、AC8 全键盘走完打开→复核→确认、AC11 减弱动效
- [ ] 9.5 截图归档 `research/after-stage2/`
- [ ] 9.6 四关全绿

## 回滚点

| 回滚到 | 命令 | 影响 |
|---|---|---|
| 阶段一结束 | `git reset --hard 8e56216` | 阶段二改动全清，阶段一保留 |
| 完全回退 | `git checkout main` | 回到重构前 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 改到判据逻辑，把 M4 已修缺陷重新打开 | 判据函数列入不可改清单（design.md §1）；`stage-view` / `todo-queue` / `accept-gate` 既有测试**零改动**是硬信号 |
| store 订阅被改成返回对象，引发全网格重渲染 | 逐字段订阅写法不可改，重构时保留原注释 |
| 删别名时漏掉某个文件导致样式塌陷 | 先跑 AC2 静态断言拿到完整清单，逐个迁完再删 |
| 真机走查烧钱 | 只用 `~/test/ppttest-walkthrough-E2` 副本与 `research/after-stage1/inject40.mjs` 合成数据；**绝不碰 `~/test/ppttest-walkthrough-E1`**；执行态用 `useRunStore.setState` 模拟 |
