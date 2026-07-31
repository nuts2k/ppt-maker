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

<!-- Patterns that should never be used and why -->

(To be filled by the team)

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

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
