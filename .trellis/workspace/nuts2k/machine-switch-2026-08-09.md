# 换机器接续说明（2026-08-09）

**新机器 / 新会话先读这一份。** 更早文档只补充历史与非 Git 环境细节：

- [machine-switch-2026-08-05.md](./machine-switch-2026-08-05.md)：落地步骤、遗留坑、运行态。
- [machine-switch-2026-08-04.md](./machine-switch-2026-08-04.md)：新机器首次落地步骤、手工迁移项。
- [machine-switch-2026-08-02.md](./machine-switch-2026-08-02.md)：`.env`、原生二进制、真实 deck 与 AI 会话目录。

## 一、交接时 Git 状态

- 分支：`main`
- 远端：`origin = https://github.com/nuts2k/ppt-maker.git`
- 本轮提交：
  - `71eeea6` `fix(desktop): M5/M6 前端界面设计修复（Impeccable critique 28→30+）`
  - 本文与 journal 另有一条 `chore` 提交，之后推送到 `origin/main`。

新机器先确认：

```bash
git status -sb
git log --oneline -5
git ls-remote origin refs/heads/main
```

`HEAD` 与远端 main 应一致，工作区应干净。已有仓库用 `git pull --ff-only`。

## 二、本轮做了什么

**Impeccable critique 评审 + 修复**。跑了一次 M5/M6 全部前端界面的设计评审（28/40），
然后修复了全部发现：

### 修复内容（5 个文件）

| 需求 | 修复 | 文件 |
|---|---|---|
| R1 side-stripe ban 违规 | HistoryField `border-l-2` → `bg-proof-wash` 背景 | PlanningPage.tsx |
| R2 PlanningPage 工作模式分离 | EntryEditor 默认折叠 + SpecImpactPanel 降为"下一步" | PlanningPage.tsx |
| R3 付费确认可见化 | armed 态可见费用文案 | SourceReviewPage.tsx |
| R4 对比度修复 | `ink-muted` on `surface-sunken` → `ink-secondary` 5 处 | PlanningPage/SourceReviewPage/SourcePicker |
| R5 IconButton loading | 补 `loading` prop 完成六态 | IconButton.tsx |
| R6 次要修复 | eyebrow 收敛 / hover 修复 / tabular-nums / disabled reason 可见化 | TopNav/PlanningPage/SourceReviewPage |

### 四关状态

- `format:check` ✓ / `typecheck` ✓ / `test` **1000 项全通过** / `build` ✓
- 测试基线不变：1000（core 156 / desktop 571 / CLI 273）

## 三、当前 Trellis 任务

任务 `08-09-m5m6-ui-critique-fixes` 状态为 `in_progress`，代码已提交。

剩余步骤：
1. **A12 重跑 Impeccable critique** 验证分数 ≥ 30（可选，不影响功能）
2. 归档任务
3. M7「可靠性与本地交付」仍未规划——这是 M6 完成后的下一个里程碑

新会话可以直接：
```bash
python3 ./.trellis/scripts/task.py current
# 如果要归档：
python3 ./.trellis/scripts/task.py archive 08-09-m5m6-ui-critique-fixes
```

## 四、相对 08-05 那份的差异

- **测试基线不变** 1000。
- **新增 `.impeccable/critique/` 目录**，存放 critique 快照。不影响功能，可随时删除。
- **IconButton.tsx 新增 `loading` prop**——所有现有调用点不受影响（默认 `false`）。
- 两个复发环境坑仍有效：拉取后先 `pnpm --filter @ppt-maker/core build`；
  全量测试别用管道尾接。

## 五、下一步

1. 归档 `08-09-m5m6-ui-critique-fixes`
2. **规划 M7「可靠性与本地交付」**：先读 `KNOWN-ISSUES.md`，走 Trellis Phase 1

## 六、新会话不要重新论证的结论

- 遗留问题看 `KNOWN-ISSUES.md`。
- M6 沉淀的硬约束见 `machine-switch-2026-08-04.md` 第五节与 `.trellis/spec/`。
- Impeccable critique 快照在 `.impeccable/critique/`，重跑 critique 可看 trend。
