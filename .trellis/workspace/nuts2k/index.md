# Workspace Index - nuts2k

> Journal tracking for AI development sessions.

---

## Current Status

<!-- @@@auto:current-status -->
- **Active File**: `journal-1.md`
- **Total Sessions**: 9
- **Last Active**: 2026-08-04
<!-- @@@/auto:current-status -->

---

## Active Documents

<!-- @@@auto:active-documents -->
| File | Lines | Status |
|------|-------|--------|
| `journal-1.md` | ~531 | Active |
<!-- @@@/auto:active-documents -->

---

## Session History

<!-- @@@auto:session-history -->
| # | Date | Title | Commits | Branch |
|---|------|-------|---------|--------|
| 9 | 2026-08-04 | 完成 M6 策划对话与真机验收 | `5d83edf`, `fd8a4eb` | `main` |
| 8 | 2026-08-04 | 完成内容策划工作台与付费走查 | `8e5289f`, `1ebcfa6` | `main` |
| 7 | 2026-07-31 | 桌面端设计语言重构 · 阶段三四（键盘陷阱修复 + 基座收口）与环境迁移补齐 | `dc18b1a`, `ef5842e` | `main` |
| 6 | 2026-07-31 | 桌面端设计语言重构 · 阶段一（令牌 + 组件基座 + 控制台页） | `642698f`, `2ff2920`, `f93bf08`, `dc95f8d`, `1cfbb72`, `8e56216` | `design/desktop-language-rebuild` |
| 5 | 2026-07-30 | 复核与验收链路三处缺陷 | `0654798`, `cabbcde`, `6238ece` | `main` |
| 4 | 2026-07-29 | 阶段 E 真机走查：AC1–AC17 全通过，另修三条会话层/文案缺陷 | `c2fca5d`, `593ab65` | `main` |
| 3 | 2026-07-28 | M4 复核链路简化收尾：E2 兼容性验证、PRD 验收核对与 spec 沉淀 | `bf8fb00` | `main` |
| 2 | 2026-07-25 | M4 E4 端到端走查：修复四处静默失败并沉淀诊断路径 | `cc98634`, `2e04671`, `618f81e` | `main` |
| 1 | 2026-07-20 | 完成 M0 项目骨架与技术基线 | `2698695` | `main` |
<!-- @@@/auto:session-history -->

---

## 接续说明

- [machine-switch-2026-08-04.md](./machine-switch-2026-08-04.md) — **当前最新，新机器 / 新会话先读这个**。
  子任务②已实现、检查、付费走查并归档；下一步是子任务③先走 Phase 1，未经审阅不要开工。
  含当前关键提交、877 测试基线、新机器命令、③ 不要重新论证的边界与非 Git 迁移项。
- [machine-switch-2026-08-03.md](./machine-switch-2026-08-03.md) — **新机器 / 新会话先读这个**。
  子任务②实现前的历史状态；含 E1–E5 五个已确认决策与
  四条自定技术判断（都不要重新论证）、测试基线 854、`core/dist` 拉取后必然过期、
  以及「记忆目录名随仓库路径变，别硬编码」的路径订正。
- [m6-handoff-2026-08-03.md](./m6-handoff-2026-08-03.md) — 子任务① 交付了什么（可直接用的符号表）、
  ① 留下的两条硬交接约束、本轮验证方式上的收获（变异验证、信号产生了却没人读）。
- [m6-handoff-2026-08-02.md](./m6-handoff-2026-08-02.md) — M6 父任务规划已完成、
  停在用户审阅，尚未 start；含九条决策结论、阶段一待办、「content-spec 无独立版本轴」的订正，
  以及 M5 已交付、M6 不要重做的清单。
- [machine-switch-2026-08-02.md](./machine-switch-2026-08-02.md) — 不在 git 里的三样
  （`.env` 两个键、Swift 原生二进制、`~/test/` 真实 deck）、新机器落地步骤与 774 测试基线，
  以及 M5 留给 M6 的三条观察。换机器时先读它。

---

## Notes

- Sessions are appended to journal files
- New journal file created when current exceeds 2000 lines
- Use `add_session.py` to record sessions