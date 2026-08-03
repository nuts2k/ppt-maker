# 换机器接续说明（2026-08-03）

**新机器上先读这一份**，它是当前最新状态。前两份仍然有效但只作补充：
[machine-switch-2026-08-02.md](./machine-switch-2026-08-02.md) 讲「不在 git 里的三样」，
[m6-handoff-2026-08-03.md](./m6-handoff-2026-08-03.md) 讲子任务① 交付了什么。

## 一、当前状态：② 的 Phase 1 已完成，停在审阅门

- 父任务 `08-02-content-planning-workbench`：`in_progress`。
- 子任务① `08-02-spec-edit-and-history`：**代码已完工**（提交 `51a1823`），
  但 `task.py finish` 只清 active task、**不改 status**，所以它至今仍是 `in_progress`，
  父任务因此显示 `[0/3 done]`。要变成已完成得 `task.py archive`，**尚未决定要不要做**。
- 子任务② `08-02-planning-view`：**四份规划产物已写完**（`prd.md` 已做 convergence pass、
  `design.md`、`implement.md`、两份 jsonl 各 9 / 8 条，`task.py validate` 通过），
  **未 `task.py start`**。下一步就是审阅通过后 start，然后按 `implement.md` 的 L1 开工。
- 子任务③ `08-02-planning-conversation`：`planning`，只有播种的 `prd.md`，未走 Phase 1。

## 二、② 的规划里，新机器不要重新论证的九条

**五个已与用户确认的决策**（写在 ② 的 `prd.md`〈Phase 1 决策〉表，E1–E5）：

1. **E1** ② 包含「从零手工建规格」完整路径（建空 deck → 编辑 → 能 `deck run`），
   不只是改已有 deck。
2. **E2** **显式保存按钮**，不做失焦即存、不做防抖——一次编辑会话 = 一条变更记录。
3. **E3** ② 做**最小历史面板**（列表 + 逐条 diff + 回滚），补上子任务地图里三方都没
   认领的父任务 A5 缺口。
4. **E4** 批量重生成：离线用例盖全部分支（stub generator），**真机只跑 1 页**真实调用。
5. **E5** 左栏本轮放历史面板，③ 接入时加「对话 / 历史」分段切换，不改布局骨架。

**四条自定的技术判断**（写在 ② 的 `design.md`，逐条带理由）：

6. **保存前不做过时预告**——`previewSpecChange` 会再跑一遍全 deck 对账（读两遍 22 个
   JSON），而 `applySpecChange` 返回值里已经有 `drifted` / `missing`。`style` 的 deck 级
   爆炸半径改用字段旁常驻说明承担。
7. **不给 `applySpecChange` 加「跳过对账」开关**——跳过就拿不到 `drifted` / `missing`，
   而它们正是保存后更新过时清单所必需的。坏页上下文改为 main 侧**只在失败路径上**
   复用已有容错的 `buildDeckStatusDetailed` 补齐，正常保存零额外开销。
8. **批量重生成接进既有 `SourceTaskRunner`**，不开新通道（互斥、进度归一、活动日志
   三件事刚好全都需要）；`selection` 恒用 `{kind:"labels"}` 而非 `all-drifted`——后者
   会在 CLI 侧重新解析集合，实跑页数可能与确认页数不一致。
9. **过时清单取全量而非增量**（`ApplySpecChangeResult.drifted` 只含本次新增），
   `missing` 页单列且不可勾选。

**已知缺口，不在本轮修**：关窗时的未保存草稿拦截。main 侧要动窗口生命周期，
属应用级改动，不该由一个视图捎带引入。已写进 design §4.2 与 implement.md 风险表。

## 三、路径订正（重要，别再被绕一次）

`machine-switch-2026-08-02.md` §三写「本机仓库在 `~/Work/ppt-maker`，早先写成
`Workspace` 是笔误」——**那是上一台机器的事实**。2026-08-03 这台机器的仓库实测在
`/Users/kelin/Workspace/ppt-maker`，AI 记忆目录相应是
`~/.claude/projects/-Users-kelin-Workspace-ppt-maker/`。

**结论：这个目录名按仓库路径生成，随机器变，别硬编码。新机器上以 `pwd` 为准。**
AI 记忆不跟仓库走，新机器上那个目录是空的。

## 四、本机（2026-08-03）实测的环境结论

新机器落地步骤照抄 `machine-switch-2026-08-02.md` §二，只有两处要更新：

- **测试基线 854**（core 141 / desktop 474 / cli 239），本机 `pnpm -r test` 全绿实测。
- **`packages/core/dist` 拉取后必然是过期的**。今天 `git pull` 后 dist 里没有
  `planning-contracts`，`pnpm typecheck` 会报一串假的「缺导出成员」。
  **先 `pnpm --filter @ppt-maker/core build`**，真机走查还要
  `pnpm --filter @ppt-maker/cli build`（`tools/snap.sh` 走 `apps/cli/dist`）。

本机 `doctor`：5 通过 / 1 警告（Node 25.8.0 偏离 24 LTS，已知无害）/ 0 失败。
PowerPoint、Microsoft YaHei、Swift 6.3 均在位。

## 五、`~/test/` 要带什么

三份必带**在本机都在且未被本轮改动**（本轮只做规划，没碰任何 deck）：

| 目录 | 大小 | 实测状态 |
|---|---|---|
| `wt4-spec-2026-08-02` | 7.6M | 4 页全 `generated`，**page-04 = `drifted`**，其余 in-sync |
| `wt4-append` | 43M | 11 页混合来源，只有 page-11 有 `specEntryId` |
| `ppttest-2026-07-25` | 29M | 2 页 imported，无 `content-spec.json`、无 `specDrift` |

`~/test/` 全目录 492M，其余都是 2026-08-02 走查的中间产物，**可弃**（清单见
`machine-switch-2026-08-02.md` §一.3）。

⚠️ **`wt4-spec-2026-08-02` 的 page-04 基线即 drifted**，不是残留脏数据。
跑任何批量重生成前必须先 `deck status --json` 确认集合，照搬脚本改另一条会变成
2 页 = 2 倍花费（这是 W1 已经踩过的）。

## 六、新机器上的第一步

```bash
git clone ... && cd ppt-maker
cp .env.example .env && $EDITOR .env      # OPENAI_API_KEY / OPENAI_BASE_URL
pnpm install && pnpm build                # 含 build:vision + build:pdf
node apps/cli/dist/index.js doctor
pnpm -r test                              # 期望 854

# 带 ~/test 的三份（约 80M）

# 然后：
python3 ./.trellis/scripts/task.py list           # 确认 ② 仍是 planning
# 审阅 .trellis/tasks/08-02-planning-view/ 四份产物 → task.py start → 按 implement.md L1 开工
```
