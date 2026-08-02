# 子任务④ 已完成（2026-08-02）

七个实现阶段 + U1–U14 真机走查全部完成并已提交。本文件只留结论与指路，
新会话不必再从这里开工。

| 项 | 状态 |
|---|---|
| 阶段一～七（`implement.md`） | 完成 |
| U1–U13 真机走查 | **完成**，逐条证据见 [`walkthrough.md`](./walkthrough.md) |
| U14 全量验证 | 通过（core 103 / desktop 466 / cli 163 = **732**，开工基线 709） |
| spec 沉淀（3.3） | 完成，见下 |
| 提交（3.4） | 完成 |
| 回写父任务 `implement.md` 的 2.4 | 完成 |

## 走查查出并修掉的 7 个缺陷

摘要在 [`walkthrough.md`](./walkthrough.md) 的同名小节，每条都有根因、改法与回归锁。
其中值得记住的两条：

- **切换工作区后活动日志恒为空**是**既有缺陷**，不是 ④ 引入的：`activity-store.reset()`
  按序号一刀切作废在途请求，把已经属于新 deck 的那次 `load` 也连坐掉了。
  这条同时回写了 `.trellis/spec/frontend/state-management.md`——那份 spec 当时写的
  正是「`reset()` 里要一并作废在途请求（`listSeq += 1`）」，规则本身有缺口。
- **第 7 个缺陷是修第 2 个时自己引入的**（清零把触发切换的那个结果一起清了），
  由走查在同一轮里抓回来。改动一处「换 deck 时清什么」，务必回头看一眼
  「这次切换是谁触发的、它的结果还在不在」。

## 本轮沉淀进 spec 的 5 条

| 落点 | 内容 |
|---|---|
| `frontend/state-management.md`〈新增一个切换维度〉 | **作废在途请求必须按身份，不能按序号一刀切**（附反例代码与症状） |
| `frontend/state-management.md`〈一个判据兼职两件事〉 | 合成关系的锁**单独锁不住**这条缺陷，必须另有一条用例直接锁住被放宽的能力本身（变异验证实证） |
| `guides/silent-failure-thinking-guide.md` 预防清单 | ① 返回值有几种结局，每一种都有人渲染吗；② 新写盘的东西靠什么让界面跟上 |
| `guides/silent-failure-thinking-guide.md` 第二类 | 全局单例的事件订阅，「没挂」和「挂了两处」都是静默的 |
| `guides/cross-layer-thinking-guide.md` Mistake 5 | `channels.ts` 是类型交界，不得引 `@cli/*`；约束必须落成静态断言 |

## 走查手段（下次要复现时看这里）

`REMOTE_DEBUGGING_PORT=9222 V8_INSPECTOR_PORT=5858 pnpm desktop`，renderer 走 CDP，
main 走 node inspector。**原生文件选择框与确认框在主进程被打桩**，理由与它对结论的
影响写在 `walkthrough.md` 开头。相关的本机限制（能点不能敲键、锁屏后全废、
两个 Electron 实例抢端口）已记进项目记忆的〈环境前置条件〉。

## ④ 之后

父任务 `.trellis/tasks/07-31-page-sources-and-content-generation/` 的**阶段三集成验收**
（A1–A13 逐条走查，A2 / A3 / A4 必须真实走查）。三条接续点已回写进父任务
`implement.md` 的 2.4，其中 `~/test/wt4-append` 已经是一个 11 页混合来源的现成走查基线。
