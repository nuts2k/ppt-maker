# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | 部分填充（Common Mistakes 六条均由真实缺陷验证：快照与事件混用、会话层盖住耐久层、start/finish 事件不成对、错误条指错阶段、一个判据兼职两件事、切换维度激活既有竞态） |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | 部分填充（禁止项：Tab 改列表导航时无条件 preventDefault、只换 ARIA role 不兑现键盘承诺、为摘属性给通用组件加开关、求助入口只有一个会失效的键位；测试要求：断言须变异验证、静态断言用 rg、规则测在纯函数产物上、放行类修复要配反向用例、biome-ignore 紧邻报错行、走查脚本自己归零状态） |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
