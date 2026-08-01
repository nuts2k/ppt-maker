# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

### 把 Tab 改作列表导航时，禁止无条件 `preventDefault`

「Tab 在列表内 = 切换到下一项」是本项目复核界面刻意的键盘模型，本身没问题。
出问题的是**撞到边界之后仍然吞掉按键**：末项按 Tab、首项按 ⇧Tab 都原地不动，
焦点一旦进入列表就再也出不去。这是 WCAG 2.1.2 键盘陷阱，A 级，实测连按 12 次无位移。

正确写法是**先动再决定拦不拦**：

```ts
// review-keyboard.ts —— 判定层给出「到边界时是否放行」
case "Tab":
  return { kind: "move", delta: shift ? -1 : 1, escapeAtEdge: true };
case "ArrowDown":
  return { kind: "move", delta: 1, escapeAtEdge: false };

// BlockListPanel.tsx —— 派发层按实际是否移动决定
if (action.kind === "move") {
  const moved = moveBy(action.delta);
  if (moved || !action.escapeAtEdge) event.preventDefault();
  return;
}
```

出口只开给 Tab，不开给 ↑↓：箭头键抢的是 textarea 内的光标移动，放行会让光标乱跳，
而且箭头本来就带不出焦点，对陷阱毫无帮助。**「哪个键该放行」取决于该键在浏览器里
原本承担什么，不是一刀切。**

### 禁止只换 ARIA role 而不兑现该 role 承诺的键盘行为

把一排 `aria-pressed` 按钮换成 `role="radiogroup"` / `role="radio"` 是对的——
互斥档位本来就不是一组独立的切换按钮。但 role 不只是标签，它是**一份承诺**：
radiogroup 意味着「整组只占一个 Tab 停靠点，组内用箭头键移动」。

只改 role 不改键盘，读屏用户会按箭头键然后发现什么也没发生——**比诚实地保留
`aria-pressed` 更误导人**。换 role 时必须同时给出：

- roving `tabIndex`（选中项 0、其余 -1）
- 箭头键 / Home / End 的组内导航（左右上下四个方向都收，习惯键位并不统一）
- 一组都没选中时的兜底，否则全组 `tabIndex` 都是 -1，整组从 Tab 序列里消失

### 禁止为了摘掉一个属性而给通用组件加开关

分段档位需要 `aria-checked`，而基座 `Button` 把 `selected` 与 `aria-pressed` 绑死
（那对独立的切换按钮是对的）。给 `Button` 加一个「不要输出 aria-pressed」的 prop，
等于把分段控件的特殊情况渗进通用按钮——变体表就是这样开始腐化的。

**语义不同就复用变体、不复用组件**：直接渲染 `<button>` + `buttonVariants(...)`，
视觉仍出自同一张变体表，不构成漂移。同理，整块可点击的折叠面板用
`cn(panelVariants(), …)` 拼在 `<button>` 上，而不是给 `Panel` 开放 `as="button"`。

判断标准是「视觉是否仍单源」，不是「是否用了那个组件」。

### 禁止让「求助入口」只有一个会失效的键位

`?` 在 input / textarea / contentEditable 内不拦截是对的——那里它是内容不是命令。
但如果快捷键面板只有 `?` 这一个键位，后果是：焦点落在常驻 textarea 的那一档时，
键盘用户连「怎么出去」都查不到，唯一出口是鼠标。**陷阱里没有任何键盘自救手段。**

修法是再给一个带修饰键的等价入口（本项目是 `⌘/` / `Ctrl+/`），它不与输入内容冲突，
因而不受上面那条限制。同时**提示文案要一并说出它**——旧文案「按 Esc 或再按一次 ? 收起」
对可编辑场景是错的，而那恰恰是最需要提示的场景。

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

### 断言必须变异验证过，否则它只是看起来在守

写完一条「锁住某规则」的断言，**先把被守的东西改坏，确认它真的转红，再改回来**。
没红过的断言与没写没有区别，而且更糟——它给人一种已被覆盖的错觉。

2026-07-31 的实证：阶段一交付时 AC5「每处 transition 都带显式 duration」标记为通过，
实际上那条断言从未真正扫过任何文件（原因见下一节）。基座里三处裸 `transition-colors`
一直吃着 tailwind 配置的隐式 DEFAULT，而基座是全局默认值的源头——这里隐式，全应用都隐式。

### 静态断言用 `rg`，不要用 `grep --include`

本机 `grep` 是 ugrep 别名，`--include=*.tsx` 会**静默失效**：不报错、不匹配、退出码 0，
读起来与「一条都没命中」完全一样。凡是拿 grep 结果当验收依据的地方，一律换 `rg -g '*.tsx'`。

同时注意扫描范围：本项目把变体表放在纯 `.ts` 模块里（测试不导入 `.tsx`，见下节），
只扫 `*.tsx` 会漏掉 `components/ui/variants.ts` 这类文件。

### 渲染层的规则测在纯函数产物上，不测渲染结果

本项目刻意不装 DOM 测试库。`tsconfig.node.json` 覆盖 `test/` 且不含 `@/*` 映射，
因此可测模块必须是纯 `.ts` 且用**相对 `.js` 导入**（用 `@/` 别名会直接失去类型）。

这反而更合适：要守的是「完成态不许用饱和色」「选中态不许升级成主行动」这类**规则**，
不是某个像素长什么样。把 cva 变体表与状态表抽成纯模块（`components/ui/variants.ts`、
`status-spec.ts`），断言直接跑在它们的产物上。

一个容易漏的点：组件侧渲染的是 `cn(buttonVariants(...), className)`，`cn` 会做 tailwind-merge。
断言若只看 cva 的裸输出，就漏掉了「后写的类赢过先写的类」这一层，与真实渲染不是一回事——
**断言也要先过 `cn`**。

### 「放行」类修复必须配一条反向用例

修键盘陷阱时加的是「到边界放行」。但只测「焦点能出去」是不够的——**把列表导航整个改坏，
同样能让焦点出去**，两者在单向断言下完全不可区分。

所以走查脚本是成对的：`trap-check.mjs` 证明两端有出口，`nav-intact.mjs` 证明中间仍然
逐项推进（block-001 → … → 006）。放宽一个约束时，总要问：**什么别的东西也会产生同样的
观测结果？** 把那个也测掉。

### `biome-ignore` 必须紧邻报错行

写成多行 `//` 注释块时，`biome-ignore` 那行与目标之间隔着续行，结果是同时报
「suppression unused」和原规则未被抑制——两条都指着同一个地方，很容易读成
「注释语法写错了」而去改语法。

长解释用 `/* */` 块，`biome-ignore` 单独一行紧贴目标：

```tsx
/*
 * 这里为什么必须用 button + role="radio"（长解释）……
 */
// biome-ignore lint/a11y/useSemanticElements: 见上，APG radio group 模式
<button role="radio" …>
```

### 走查脚本必须自己归零前置状态

toggle 类 UI（面板、折叠区）的断言常写成 `!before && after`，它隐含「初始是关的」这个
未声明的前提。实际踩到：上一步截图把面板打开了，下一次 `⌘/` 正确地把它关掉，脚本却报失败。

**测前先显式归零**（按 Esc / 重置 store），不要依赖上一步留下的状态。

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
