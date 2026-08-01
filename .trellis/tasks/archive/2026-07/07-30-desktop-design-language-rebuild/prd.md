# 桌面端前端设计语言重构

## Goal

把 `apps/desktop` 渲染层从「Airtable 营销站令牌 + 散装 Tailwind 类字符串」重做为一套属于本工具自身的设计语言：可复用的令牌体系、`components/ui` 组件基座、完整交互状态与无障碍达标，为 M5（内容策划与页面图片生成）接入新界面时提供稳定的视觉与组件地基。

本任务只动渲染层表现与组件结构，**不改变任何业务行为、IPC 契约、store 状态机与磁盘产物格式**。

## Background

M4 交付的桌面复核工作台功能完整，但视觉与交互层存在系统性缺陷。实测证据（`apps/desktop/src/renderer` 全部 tsx）：

| 信号 | 命中次数 | 问题 |
|---|---|---|
| `hover:` | 0 | 桌面应用零悬停反馈 |
| `focus-visible` | 0 | 键盘焦点不可见，与 M4 已交付的「全程仅用键盘即可复核完一页」直接矛盾 |
| `shadow` | 0 | 无层级表达 |
| `duration-` | 0 | 38 处 `transition` 全是裸默认时长 |
| `prefers-reduced-motion` | 0 | 无减弱动效兜底 |
| `lucide-react` | 0 | 图标库已装未用，状态只能靠颜色承载 |
| `cva(` | 0 | cva 已装未用 |

结构性问题：

- **无组件基座**。`BUTTON_PRIMARY` / `BUTTON_SECONDARY` 以局部常量形式在 4 个文件（`TopNav` / `RunControlBar` / `SlideToolbar` / `FinalConfirmPage`）各抄一份，且已经漂移：TopNav 用 `px-4 py-2`，RunControlBar 用 `px-5 py-2.5`。不存在 `components/ui/`。
- **Register 错配**。`DESIGN.md` front-matter 至今为 `Airtable-design-analysis`，整套令牌扒自营销站。品牌签名色被挪用为状态语义色（`signature-coral`=失败、`signature-mustard`=stale），这是「怎么调都不对劲」的根因。

## Constraints

- **只动渲染层**：`src/main` / `src/preload` / `src/shared` / `packages/core` / `apps/cli` 均不在改动范围。若发现需要动这些，先停下来单独确认。
- **`open-design/` 只读**，不得写入（CLAUDE.md 硬约束）。
- **中文为界面唯一语言**，本任务不引入 i18n。
- **仅亮色主题**。暗色不在本任务范围（PRODUCT.md 已依据「白天为主、短时多次」的使用场景定调）。
- **不得引入新的运行时依赖**。`cva` / `lucide-react` / `clsx` / `tailwind-merge` 均已在 `package.json` 中，直接启用即可。
- 视觉决策必须同时符合 `PRODUCT.md`（战略）与新版 `DESIGN.md`（视觉），后者是本任务产出物之一。
- 现有测试与 `pnpm typecheck` / `pnpm format:check` 必须保持通过。

## Requirements

### R1 设计令牌重做

- 丢弃 Airtable 派生令牌，按「校样台：纸、墨、校对红」方向重建 `tailwind.config.ts` 令牌层。
- **底色必须是 chroma 0 的真中性白**，禁止滑向 cream / sand / paper / parchment / linen / ivory 暖调近白（OKLCH L 0.84–0.97、C < 0.06、hue 40–100 色带），令牌命名同样禁止使用这些词。
- **状态语义色与品牌色彻底分离**：完成 / 进行中 / 待人工 / 失效 / 失败各有独立语义令牌，不再挪用 `signature-*`。
- 颜色策略为 **Restrained**（product register 的地板）：界面近乎无彩，彩色只用于主行动、当前选中与状态指示，不用于装饰。

### R2 组件基座

- 新建 `src/renderer/components/ui/`，用 `cva` 实现带变体的基础组件，至少覆盖：Button、Badge/StatusChip、Panel/Surface、IconButton、Field 类输入。
- 4 处 `BUTTON_PRIMARY` / `BUTTON_SECONDARY` 局部常量全部消除，改为引用基座组件。
- 启用 `lucide-react` 建立图标体系，服务于 R4 的「状态不只靠颜色」。

### R3 交互状态补全

- 每个可交互组件补齐：default / hover / focus-visible / active / disabled / loading 六态（error 态按组件语义决定是否适用）。
- 全部 `transition` 显式声明时长，落在 150–250ms 区间（product register 规范）。
- 每个动效带 `prefers-reduced-motion: reduce` 分支。
- 动效只表达状态变化，不做装饰；不做页面载入编排动画。

### R4 无障碍达标（WCAG 2.2 AA）

- **A1** 每个可交互元素有可见的 `:focus-visible` 表达，焦点环自身对比度 ≥ 3:1。
- **A2** 正文对比度 ≥ 4.5:1，大字（≥18px 或粗体 ≥14px）≥ 3:1，占位符文字同样按 4.5:1 要求。每个令牌组合逐个验算，不靠肉眼。
- **A3** 完成 / 进行中 / 待人工 / 失效 / 失败五种状态同时携带形状、图标或文字，色弱可分辨。
- **A4** 全部动效尊重 `prefers-reduced-motion`。
- 保留并补齐现有 25 处 `aria-*` 语义。

### R5 控制台承载 20–50 页

- 按实际使用规模（一叠 20–50 页）重新设计控制台信息密度：缩略图尺寸、卡片/列表形态、状态的远距离可识别性。
- 提供「只看需要处理的页」这类筛选，让用户不必逐张扫过已完成页。

### R6 DESIGN.md 重写

- 用新设计语言替换现有 `Airtable-design-analysis` 内容，遵循 DESIGN.md 格式规范。
- CLAUDE.md 中「前端视觉必须遵从 DESIGN.md」的约束继续成立，故本文件必须与实现同步落地，不得滞后。

## Non-Goals

- 暗色主题。
- i18n / 多语言。
- 任何业务逻辑、IPC 契约、store 状态机、磁盘产物格式的改动。
- 新手引导 / 首运流程（M4 已明确列为非目标，本任务不翻案）。
- 移动端与响应式断点适配（Electron 桌面窗口，只需保证窗口缩放不破版）。

## Acceptance Criteria

### 自动可验证

- [x] **AC1** `pnpm typecheck`、`pnpm format:check`、`pnpm test` 全部通过。
- [x] **AC2** `grep -rIo 'signature-' src/renderer --include='*.tsx'` 命中 0 次（品牌签名色不再用于状态）。
- [x] **AC3** `grep -rn 'BUTTON_PRIMARY\s*=\|BUTTON_SECONDARY\s*=' src/renderer` 命中 0 次（局部按钮常量全部消除）。
- [x] **AC4** 所有可交互组件的 `focus-visible` 覆盖：交互元素数量与 `focus-visible` 表达数量核对一致，无遗漏。
- [x] **AC5** 每处 `transition` 均有显式 `duration-*`，且存在 `prefers-reduced-motion` 兜底。
- [x] **AC6** 令牌对比度验算表落盘，正文组合全部 ≥ 4.5:1、大字 ≥ 3:1，无一项不达标。

### 需真机走查验证（CDP 方法见 memory `desktop-walkthrough-method`）

- [x] **AC7** 控制台、文本复核页、最终确认页三页在真机截图下与新 DESIGN.md 一致，无新旧混搭残留。
- [~] **AC8** 焦点可见性部分**已达成**（控制台、复核页、最终确认页逐元素遍历，无焦点环者 0）；
      但**「完整走完」不成立**：焦点一旦进入块列表就出不来（Tab/⇧Tab 在首尾项均被
      `preventDefault` 且无位移，Esc 在常驻可编辑行无出口）。属 WCAG 2.1.2 键盘陷阱（A 级）。
      **非本次引入**：`lib/review-keyboard.ts` 自 M4 的 `9d736ca` 起未改动，
      `BlockListPanel` 的 `preventDefault` 位置本次也未动。详见 implement.md 末尾「需要用户定的两处」。
- [x] **AC9** 五种页面状态在灰度截图下仍可彼此区分（验证 A3 不依赖颜色）。
- [x] **AC10** 20–50 页规模下控制台可用：状态远距离可识别，能快速定位需处理的页。
- [x] **AC11** 开启系统「减弱动态效果」后，界面无动画残留且功能完整。

### 主观验收

- [x] **AC12** 用户认可垂直样板（令牌 + 基座 + 控制台页）的方向后，方可铺开其余两页。此为分阶段交付的硬门禁。

## Open Questions

- 走查基线工作区 `~/test/ppttest-walkthrough-E2` 只有 2 页，无法验证 AC10 的 20–50 页规模。需要另造一个多页工作区（可复制页目录批量生成，不跑流水线因而不烧 gpt-image-2）。

## Notes

- 分阶段交付：**阶段一**（令牌 + `components/ui` 基座 + 控制台页）交付并经 AC12 认可后，**阶段二**才推进复核页与最终确认页。
- 战略上下文见根目录 `PRODUCT.md`（本任务期间创建）。
