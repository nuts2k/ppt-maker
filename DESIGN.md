---
version: alpha
name: proof-desk
description: 校样台 —— 一个本地转换工具的工作界面。真中性白纸底、近黑墨字，全屏唯一一抹校对红只标「差异」与「待我处理」。完成态刻意用中性色：一叠 20–50 页里绝大多数已完成，常态必须安静，于是「有颜色的地方就是要你管的地方」成为一条可依赖的扫读规则。满屏计数与计时一律等宽数字。界面近乎无彩，因为预览区旁的任何界面色都会污染「这张底板干不干净」的判断。

colors:
  canvas: "#ffffff"
  surface: "#f7f7f7"
  surface-sunken: "#ededed"
  hairline: "#dedede"
  border: "#8c8c8c"
  border-strong: "#696969"
  focus: "#1b1b1b"
  ink: "#1b1b1b"
  ink-pressed: "#0b0b0b"
  ink-secondary: "#525252"
  ink-muted: "#6c6c6c"
  on-ink: "#ffffff"
  proof: "#be222a"
  proof-strong: "#970818"
  proof-wash: "#ffedea"
  state-running: "#0065b4"
  state-stale: "#905d00"
  state-failed: "#9d1135"

typography:
  page-title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  section-title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0
  subsection-title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  body-emphasis:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  badge:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.01em
  numeric:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
    fontVariantNumeric: tabular-nums

rounded:
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px

motion:
  duration-fast: 120ms
  duration-default: 180ms
  duration-slow: 250ms
  easing: "cubic-bezier(0.25, 1, 0.5, 1)"

components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    activeBackgroundColor: "{colors.ink-pressed}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
  button-danger:
    backgroundColor: "{colors.proof}"
    textColor: "{colors.on-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    activeBackgroundColor: "{colors.proof-strong}"
  panel-flat:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.lg}"
  panel-raised:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.lg}"
    boxShadow: "0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.06)"
  panel-sunken:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.lg}"
  field:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.border}"
    textColor: "{colors.ink}"
    placeholderColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
  focus-ring:
    outline: "2px solid {colors.focus}"
    outlineOffset: 2px
---

## Overview

**校样台（proof desk）。** 印前打样与编辑部校样纸的隐喻 —— 这个产品干的本来就是校对：两个来源的文字逐块比对，标出差异，人工签字确认。视觉系统直接借用这套已经存在了一百年、所有人都读得懂的传统，而不是再发明一套通用警告色。

Register 是 **product**：设计服务于产品，不是产品本身。使用者是开发者本人加少量同事，白天短时多次使用，一叠 20–50 页。

三个词：**克制、精确、可信**。

战略上下文（用户、反参考、设计原则、无障碍档位）见 [PRODUCT.md](./PRODUCT.md)。本文件只管「长什么样」。

## Colors

颜色策略：**Restrained**（product register 的地板，本项目不上浮）。界面近乎无彩，彩色只用于主行动、当前选中与状态指示，**不用于装饰**。

### 硬约束：中性阶 chroma 恒为 0

「纸」是**真中性白**。暖调近白（OKLCH L 0.84–0.97、C < 0.06、hue 40–100 —— 即 cream / sand / paper / parchment / linen / ivory 那一带）是被明令禁止的 AI 默认色带，**令牌命名同样禁止出现这些词**。

「暖意」由校对红、字体与排版承担，绝不由底色承担。

### 纸与面

| 令牌 | 值 | 用途 |
|---|---|---|
| `canvas` | `#ffffff` | 纸。页面底、卡片底 |
| `surface` | `#f7f7f7` | 面板、次级面、工具条 |
| `surface-sunken` | `#ededed` | 预览衬底、凹陷区 |

### 线

| 令牌 | 值 | 用途 |
|---|---|---|
| `hairline` | `#dedede` | **仅装饰性分隔**，不承担 3:1 |
| `border` | `#8c8c8c` | **控件边界**（输入框、次级按钮），已验算 ≥3:1 |
| `border-strong` | `#696969` | 强调边界、选中态 |
| `focus` | `#1b1b1b` | 焦点环 |

`hairline` 与 `border` 的区分是刻意的：WCAG 1.4.11 只要求**用于识别控件**的边界达 3:1，纯装饰分隔线不需要。把两者混成一个令牌，要么让分隔线过重，要么让输入框边界不达标。

### 墨

| 令牌 | 值 | 对比度（对 canvas） |
|---|---|---|
| `ink` | `#1b1b1b` | 17.31:1 |
| `ink-secondary` | `#525252` | 7.77:1 |
| `ink-muted` | `#6c6c6c` | 5.28:1 |

`ink-muted` 同时是**占位符文字**的颜色。占位符按正文标准要求 4.5:1，不适用「灰一点更优雅」的例外。

### 校对红

| 令牌 | 值 | 用途 |
|---|---|---|
| `proof` | `#be222a` | 差异、待我处理、危险动作 |
| `proof-strong` | `#970818` | 按压态 |
| `proof-wash` | `#ffedea` | 差异高亮底 |

**全屏唯一的高饱和色。** 只用于「差异」与「待我处理」，不用于装饰、不用于强调、不用于品牌表达。

### 状态语义

| 状态 | 颜色 | 形状 | 文字 |
|---|---|---|---|
| 已完成 | `hairline` 中性 | 实心圆 | 已完成 |
| 待执行 | `hairline` 中性 | 空心圆 | 待执行 |
| 进行中 | `state-running` `#0065b4` | 圆 + 脉冲 | 执行中 |
| 已失效 | `state-stale` `#905d00` | 三角 | 上游已变更 |
| 失败 / 中断 | `state-failed` `#9d1135` | 方块 + `X` | 失败 / 已中断 |

**核心规则：有颜色 = 要你管。**

完成是常态 —— 一叠 20–50 页里绝大多数处于完成态。用饱和色标注常态，等于把最强的视觉手段给了最不需要注意的信息。旧实现用深绿标完成，9 个绿点满屏是全局最大的噪音源。

改为中性后，一屏扫过去，**有颜色的地方就是要你管的地方**。这条规则本身就是本设计最重要的记忆点。

已完成与待执行同为中性，靠**实心/空心**区分；三个需要注意的状态各有独立形状。因此灰度下、色弱下五态均可分辨。

**措辞约定**：`stale` 不是 `failed`。「失效」是改了上游后的常规路径（保存复核内容就会产生），文案统一为「上游已变更，需重跑」；「执行失败」只留给 `failed` / `interrupted`。都写成失败会把一次正常的「改完了、重跑一下」报成红色故障。

### 状态色与品牌色彻底分离

品牌色不得挪用为状态色，状态色不得用于装饰。这是上一版设计的根本错误 —— 营销站的签名色（coral / mustard）被拿去当失败与失效的语义色，导致两套语义互相绑架。

### 验算

全部 22 项组合的对比度验算脚本与结果：
`.trellis/tasks/07-30-desktop-design-language-rebuild/research/palette-contrast.mjs`

**改动任一颜色令牌后必须重跑该脚本，22 项须全部通过。** 不靠肉眼判断。

## Typography

### Font Family

单一字族 **Inter**，多字重承担全部层级。product register 不需要 display/body 配对 —— 一个调校良好的 sans 足以承担标题、按钮、标签、正文与数据。

### Hierarchy

固定 rem 尺度，**非 fluid**。桌面端 DPI 恒定，`clamp()` 标题在侧栏里只会更难看。

| 档位 | 尺寸 | 字重 | 用途 |
|---|---|---|---|
| `page-title` | 24px | 600 | 页面标题 |
| `section-title` | 20px | 600 | 区块标题 |
| `subsection-title` | 18px | 600 | 子区块 |
| `body-emphasis` | 16px | 500 | 强调正文 |
| `body` | 14px | 400 | 界面主正文 |
| `label` | 14px | 500 | 按钮、标签 |
| `caption` | 12px | 400 | 辅助说明 |
| `badge` | 11px | 600 | 状态角标、计数徽标 |

步进比落在 1.1–1.2。界面元素多，夸张的尺寸对比只会制造噪音。

**上一版的教训**：139 处字号声明里 128 处是同一个 14px，等于没有层次。重构必须真正把层级用起来。

### 等宽数字

**全部计数与计时使用 `tabular-nums`**：`7/9`、`已用 42s`、`待确认 25`。

这个应用满屏都是计数与计时，等宽数字让秒数跳动时字宽不变、行不抖动。这是本设计三个记忆点之一。

### Principles

- 正文行长上限 65–75ch；数据与紧凑 UI 可以更密。
- `text-wrap: balance` 用于标题，`text-wrap: pretty` 用于长段落。
- 不用装饰字体做 UI 标签、按钮或数据。

## Layout

### Spacing System

4 / 8 / 12 / 16 / 24 / 32 / 48px。间距要有节奏，不要通篇一个值。

### Density

按 20–50 页的实际规模设计。控制台目标一屏容纳 **≥12 张**页面卡片。

密度是 product register 的**许可**而非缺陷：表格可以多行，面板可以多标签，用户需要时信息就该密。

### Whitespace Philosophy

留白服务于分组，不服务于「透气」。空态不得占用固定版面 —— 上一版的待办队列空态占了 27% 横向宽度，只为显示一行「暂无待办」。

## Elevation & Depth

三档，不做更多：

| 档位 | 表达 | 用途 |
|---|---|---|
| flat | `hairline` 描边 | 默认面板 |
| raised | 描边 + 极轻双层阴影 | 浮层、下拉、当前选中卡片 |
| sunken | `surface-sunken` 底、无描边 | 预览衬底、凹陷区 |

阴影极轻（4%/6% 黑），只用于表达「浮在上面」，不用于装饰。**禁止毛玻璃**。

z-index 走语义刻度：dropdown → sticky → modal-backdrop → modal → toast → tooltip。禁止 999 / 9999 这类字面量。

## Shapes

### Border Radius Scale

| 令牌 | 值 | 用途 |
|---|---|---|
| `xs` | 2px | 徽标、细条 |
| `sm` | 4px | 输入框、小控件 |
| `md` | 6px | 按钮 |
| `lg` | 8px | 面板、卡片 |
| `full` | 9999px | 状态点 |

比上一版收紧一档（旧：2/6/10/12）。校样台要精密感，12px 圆角偏消费级，读起来不像工具。

## Components

### 六态是硬性要求

**每个可交互组件必须交付六态**：`default` / `hover` / `focus-visible` / `active` / `disabled` / `loading`。少一个都算未完成。

上一版实测：`hover:` 命中 0 次，`focus-visible` 命中 0 次 —— 一个桌面应用鼠标划过毫无响应，键盘用户看不到自己在哪。

### Buttons

四个变体，两个尺寸（sm / md）。**同一个动作在任何页面都长得一样。**

| 变体 | 用途 |
|---|---|
| `primary` | 主行动。**全屏唯一一个** |
| `secondary` | 与主按钮成对出现的次要动作 |
| `ghost` | 工具栏内的低权重动作 |
| `danger` | 破坏性动作，用校对红 |

禁止把动作做成文字链接 —— 上一版最终确认页三个动作用了实心按钮 / 描边按钮 / 蓝色文字链接三种形式，没有一致的动作词汇。

### Focus Ring

```
outline: 2px solid {colors.focus};
outline-offset: 2px;
```

用 `:focus-visible` 而非 `:focus`：鼠标点击不该留下焦点环，键盘才该。2px offset 制造一圈底色间隙，因此墨底主按钮上的环也落在浅色面上（17.31:1）。

### Status

`StatusDot`（纯点）与 `StatusChip`（点 + 文字）共用同一张状态表。**组件内不得自行拼色** —— 状态样式只能来自唯一的状态映射表，否则轨道、队列、日志三处会出现语义漂移。

### Empty States

空态要教会界面怎么用，不是写「暂无内容」。且不得占用固定版面。

## Motion

| 令牌 | 值 |
|---|---|
| `duration-fast` | 120ms |
| `duration-default` | 180ms |
| `duration-slow` | 250ms |
| `easing` | `cubic-bezier(0.25, 1, 0.5, 1)`（ease-out-quart） |

- 全部 transition **显式声明时长**，落在 150–250ms。用户在任务流里，不该等编排动画。
- 缓动统一 ease-out 系，**无回弹、无弹性**。
- 动效只表达**状态变化**：hover / focus / 展开收起 / 状态切换。
- **不做页面载入编排动画。**
- 每个动效必须有 `prefers-reduced-motion: reduce` 分支。全局兜底在 `index.css`，但**不替代**逐组件降级 —— `running` 的脉冲若被压成静止就失去可辨识度，组件侧需自行降级为静态描边。

## Do's and Don'ts

### Do

- 让预览区周边保持无彩 —— 用户要靠它判断底板干不干净。
- 把颜色留给需要动作的状态。
- 计数与计时一律等宽数字。
- 同一个动作在任何页面都用同一个组件。
- 状态同时给颜色、形状和文字。
- 改颜色令牌后重跑对比度脚本。

### Don't

- **不要**把底色调成暖调近白（cream / sand / paper 那一带）。
- **不要**用品牌色当状态色，或反过来。
- **不要**用饱和色标注完成这类常态。
- **不要**用毛玻璃、渐变字、卡片彩色左边条。
- **不要**用大数字 + 小标签的 KPI 卡片排（SaaS 仪表盘模板）。
- **不要**把动作做成文字链接。
- **不要**在组件里就地拼状态色。
- **不要**让空态占用固定版面。
- **不要**只用颜色区分状态。
- **不要**发明标准控件的替代品（自定义滚动条、怪异表单控件）。

## Responsive Behavior

Electron 桌面窗口，**不做移动端适配**。只需保证窗口缩放不破版：

- 响应式行为是**结构性**的（面板折叠、列数变化），不是流体字号。
- 长文本必须能换行或截断，**不得溢出容器** —— 上一版最终确认页右栏文字被容器直接切断。
- 无断点网格用 `repeat(auto-fit, minmax(<min>, 1fr))`。

## Accessibility

目标 **WCAG 2.2 AA**。四条硬性验收项见 [PRODUCT.md](./PRODUCT.md) 的 Accessibility & Inclusion 段。

界面唯一语言为中文，不做 i18n。

## Known Gaps

- **暗色主题未做**。当前场景是白天短时多次使用，暗色不在首期范围。若将来要做，中性阶 chroma 0 的设定可直接翻转，状态色需重新验算对比度。
- **本文件描述的是重构目标状态**，实现分两阶段落地：阶段一（令牌 + 组件基座 + 控制台页）、阶段二（文本复核页 + 最终确认页）。迁移期 `tailwind.config.ts` 中保留旧令牌别名，阶段二结束前删净。
