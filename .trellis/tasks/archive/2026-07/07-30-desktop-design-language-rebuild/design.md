# 技术设计：桌面端设计语言重构

## 1. 边界与不变量

### 改动范围

| 区域 | 是否改动 |
|---|---|
| `apps/desktop/src/renderer/**` | ✅ 表现层与组件结构 |
| `apps/desktop/tailwind.config.ts` | ✅ 令牌层重建 |
| `apps/desktop/src/renderer/assets/index.css` | ✅ 加基础层（焦点环、减弱动效） |
| 根 `DESIGN.md` | ✅ 重写 |
| `src/main` / `src/preload` / `src/shared` | ❌ 不动 |
| `packages/core` / `apps/cli` | ❌ 不动 |
| `open-design/` | ❌ 只读（CLAUDE.md 硬约束） |

### 必须保持不变的契约

- **IPC 契约**：`window.api.*` 全部签名与行为不变。
- **store 状态机**：`run-store` / `deck-store` / `slide-store` / `ui-store` 的字段与 action 语义不变。**逐字段订阅的写法必须保留**——`SlideCard` / `RunControlBar` 现有注释已说明：selector 返回新对象会导致每次 store 变更重渲染整片网格。重构组件时不得改成返回对象的 selector。
- **纯逻辑模块**：`lib/stage-view.ts`（除颜色表外）、`lib/accept-gate.ts`、`stores/todo-queue.ts`、`lib/review-*.ts` 的**判据逻辑一律不动**。这些模块承载着 M4 走查得来的正确性，改它们等于把已修的缺陷重新打开。
- **磁盘产物格式**：不涉及。

### 唯一允许的逻辑改动

`lib/stage-view.ts` 的 `STAGE_DOT_CLASS` 常量（状态 → 样式映射）。这是纯展示映射，不含判据。**判据函数 `blockingStageView` / `currentStageView` / `deriveStageViews` 一律不动。**

## 2. 令牌层

### 2.1 调色板（已逐项验算，22/22 通过）

验算脚本与结果：`research/palette-contrast.mjs` / `research/palette-contrast.txt`。修改任一令牌后必须重跑。

| 令牌 | OKLCH | HEX | 用途 |
|---|---|---|---|
| `canvas` | `oklch(1 0 0)` | `#ffffff` | 纸。**chroma 严格为 0** |
| `surface` | `oklch(0.976 0 0)` | `#f7f7f7` | 面板、次级面 |
| `surface-sunken` | `oklch(0.945 0 0)` | `#ededed` | 预览衬底、凹陷区 |
| `hairline` | `oklch(0.902 0 0)` | `#dedede` | **仅装饰性分隔**，不承担 3:1 |
| `border` | `oklch(0.64 0 0)` | `#8c8c8c` | **控件边界**，≥3:1（WCAG 1.4.11） |
| `border-strong` | `oklch(0.52 0 0)` | `#696969` | 强调边界 |
| `focus` | `oklch(0.22 0 0)` | `#1b1b1b` | 焦点环 |
| `ink` | `oklch(0.22 0 0)` | `#1b1b1b` | 正文、主按钮底 |
| `ink-secondary` | `oklch(0.44 0 0)` | `#525252` | 次要文字 |
| `ink-muted` | `oklch(0.53 0 0)` | `#6c6c6c` | 弱化文字、**占位符**（4.93:1，仍达 AA） |
| `proof` | `oklch(0.52 0.19 25)` | `#be222a` | **校对红**，全屏唯一高饱和色 |
| `proof-strong` | `oklch(0.43 0.17 25)` | `#970818` | 校对红按压态 |
| `proof-wash` | `oklch(0.96 0.022 25)` | `#ffedea` | 差异高亮底 |
| `state-running` | `oklch(0.5 0.15 250)` | `#0065b4` | 进行中 |
| `state-stale` | `oklch(0.52 0.12 75)` | `#905d00` | 失效 |
| `state-failed` | `oklch(0.45 0.17 15)` | `#9d1135` | 失败 |

**命名禁令**：不得出现 `paper` / `cream` / `sand` / `parchment` / `linen` / `ivory` / `bone` / `flour`。这类命名本身即是 impeccable 认定的 AI 破绽，且会诱导后续维护者把中性白改成暖调近白。

**已删除令牌**：`signature-*` 全部七个、`primary` / `primary-active`（并入 `ink`）、`body`（并入 `ink-secondary`）、`muted`（更名 `ink-muted`）、`link` / `link-active`、`info` / `info-border`、`success` / `success-border`、`surface-soft` / `surface-strong` / `surface-dark` / `surface-dark-elevated`。

### 2.2 状态语义表（`STAGE_DOT_CLASS` 的替代）

**核心决策：完成态不用颜色。** 完成是常态，一叠 20–50 页里绝大多数处于完成态；用饱和绿标注常态，等于把最强的视觉手段给了最不需要注意的信息（基线截图实证：9 个深绿点满屏）。

改为：**有颜色 = 要你管**。

| 状态 | 颜色 | 形状/图标 | 文字 | 说明 |
|---|---|---|---|---|
| `completed` | `hairline` 中性 | 实心圆 | 已完成 | 安静，不抢视线 |
| `running` | `state-running` | 圆 + 脉冲 | 执行中 | 唯一带动效的状态 |
| `pending` | `hairline` 中性 | 空心圆 | 待执行 | 与 completed 靠**填充与否**区分 |
| `stale` | `state-stale` | 三角 | 上游已变更 | 措辞遵循 spec：**不是失败** |
| `failed` / `interrupted` | `state-failed` | 方块 + `X` 图标 | 失败 / 已中断 | |

`completed` 与 `pending` 同为中性色，靠**实心/空心**区分——满足 A3「灰度下可分辨」，且不引入第五种颜色。

三个需要注意的状态各有独立形状（三角 / 方块 / 圆），配 lucide 图标，色弱与灰度下均可区分。

### 2.3 字体与尺度

- **单一字族**：Inter（已在用）。product register 不需要 display/body 配对。
- **固定 rem 尺度，非 fluid**：桌面端 DPI 恒定，`clamp()` 标题在侧栏里只会更难看。
- **步进比 1.125–1.2**：本应用界面元素多，夸张的对比只会制造噪音。
- **`tabular-nums` 用于全部计数与计时**：`7/9`、`已用 42s`、`待确认 25`。这是本设计三个记忆点之一——数字不再随秒跳动而抖动。

## 3. 组件基座 `components/ui/`

用已装未用的 `cva` 实现。每个组件必须交付六态：`default` / `hover` / `focus-visible` / `active` / `disabled` / `loading`。

| 组件 | 变体 | 取代 |
|---|---|---|
| `Button` | `variant`: primary / secondary / ghost / danger；`size`: sm / md | 4 份 `BUTTON_PRIMARY` / `BUTTON_SECONDARY` 局部常量 |
| `IconButton` | 同上 + 强制 `aria-label` | 现有裸 `<button>` 图标位 |
| `StatusDot` | `status`: 上表五态；`size`: sm / md | `STAGE_DOT_CLASS` 拼类 |
| `StatusChip` | 同 `StatusDot`，带文字与图标 | 现有裸 span 标签 |
| `Panel` | `elevation`: flat / raised / sunken | 满屏 `border border-hairline bg-canvas` |
| `Field` | input / textarea / checkbox 统一边框与焦点 | 裸 `<input>`（严格模式复选框等） |

**统一焦点环**：`focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2`。offset 制造白色间隙，因此在墨色主按钮上同样可见（环落在按钮外的浅色面上，17.31:1）。

## 4. 筛选：复用既有判据，且不得造成能力消失

### 4.1 口径来源

「需要处理的页」**直接复用 `stores/todo-queue.ts` 的 `deriveTodoQueue`**，不新写判据。

依据 spec [State Management · 同一件事在多处展示](../../spec/frontend/state-management.md)：*同一件事在多处展示时，它们是同一个函数算出来的吗？不是的话，迟早会各说各话。* 控制台筛选与待办队列问的是同一个问题，必须同源。

实现：`ConsolePage` 取 `flattenTodoQueue(queue)` 的 `slideId` 集合作为筛选依据。

### 4.2 硬约束：不得让「打开已完成页」这个能力消失

依据 spec [State Management · 一个判据兼职两件事](../../spec/frontend/state-management.md) 记录的真实缺陷（2026-07-30）：把「待办」语义绑到「可达」上，导致验收后最终确认页整个消失，页内的「重做底图」随之无法触达。

本次筛选有完全相同的风险形状：**默认隐藏已完成页 → 用户无法打开已完成页复看**。

因此：

- 「全部 42 / 待处理 5」切换**常驻可见**，不折叠、不藏进菜单。
- 筛选**只影响列表渲染**，不影响任何判据、导航或键盘遍历口径。
- 待办队列面板的「处理下一项」仍走 `nextTodoItem`，与筛选状态无关。
- 筛选状态存 `ui-store`（会话级），**不写入磁盘**——不产生新的持久化状态，也就不可能与耐久层分歧。

## 5. 阶段轨道折叠

现状：`StageTrack` 在复核页与最终确认页各占 **175px** 纵向，显示 9 个等权重点位。用户此时已在页内作业，阶段信息价值极低。

改为 `StageRail` 两态：

- **收起（默认）**：单行 ~32px。一条分段进度条 + 一句话状态（`全部阶段已完成 9/9` 或 `停在「生成遮罩」· 上游已变更`）。异常阶段用 §2.2 的形状+颜色直接标在条上。
- **展开**：点击后显示现有完整九段轨道。展开状态存 `ui-store` 会话级。

释放 ~143px，占复核页可视高度的 **11%**。

控制台卡片内的 `StageTrack`（`size="sm"`）保留但换新状态表。

## 6. 控制台重做（20–50 页）

- 卡片从当前 `lg:grid-cols-3 2xl:grid-cols-4` 改为更紧凑的列数与更小缩略图，目标一屏容纳 ≥12 张。
- 状态需**远距离可识别**：状态形状与颜色置于卡片固定角位，不随文字长度浮动。
- 待办队列面板空态不再占固定宽度：无待办时收成窄条或整体隐藏，仅保留一个可展开入口。
- 顶部信息条修正基线截图暴露的**自相矛盾**：顶部「已完成 2」与底部活动日志「完成 0，待人工 1」口径不一。两者含义不同（前者是 deck 累计状态，后者是本次 run 结果），需在文案上明确区分，避免读者误判。

## 7. 动效规范

- 全部 `transition` 显式声明时长，落在 **150–250ms**（product register 规范）。
- 缓动统一 ease-out 系（`cubic-bezier(0.22, 1, 0.36, 1)`），不用 bounce / elastic。
- 只表达状态变化：hover / focus / 展开收起 / 状态切换。**不做页面载入编排动画**。
- `index.css` 加全局兜底：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

全局兜底是保底，**不替代**逐组件的 reduced-motion 分支（`running` 状态的脉冲需要降级为静态描边而非直接消失，否则该状态失去可辨识度）。

## 8. 兼容性与回滚

- **无数据迁移**：不触碰任何持久化格式。
- **无依赖变更**：`cva` / `lucide-react` / `clsx` / `tailwind-merge` 均已在 `package.json`。
- **回滚粒度**：阶段一与阶段二分别为独立提交序列。令牌层（`tailwind.config.ts` + `index.css`）与基座层（`components/ui/`）先落地且可独立回滚；页面迁移逐页提交。
- **风险点**：令牌重命名会同时touch 24 个组件文件。缓解——先建新令牌**并保留旧令牌别名**，逐页迁移完成后再删除旧令牌，避免中途出现大面积样式塌陷。旧令牌别名必须在阶段二结束前删净（AC2 会验）。

## 9. 未决

- 走查基线工作区 `~/test/ppttest-walkthrough-E2` 只有 2 页，无法验 AC10。需另造多页工作区：复制 `slides/page-01` 目录并改 `slideId` / `pageLabel` 批量生成至 ~40 页，**不跑流水线**因而不产生 gpt-image-2 调用。
