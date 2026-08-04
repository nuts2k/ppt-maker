# 换机器接续说明（2026-08-04）

**新机器 / 新会话先读这一份。** 更早的接续文档只作补充：

- [machine-switch-2026-08-03.md](./machine-switch-2026-08-03.md)：子任务②实现前的技术决策、环境结论和真实 deck 基线。
- [machine-switch-2026-08-02.md](./machine-switch-2026-08-02.md)：不进 Git 的 `.env`、原生二进制和 `~/test/` 迁移清单。
- [m6-handoff-2026-08-03.md](./m6-handoff-2026-08-03.md)：子任务①交付的底层符号与硬约束。

## 一、当前 Git 状态

- 分支：`main`
- 交接前工作区：干净
- 本轮关键提交：
  - `8e5289f` `feat: 新增内容策划工作台`
  - `1ebcfa6` `docs(m6): 记录策划工作台付费走查`
  - `cc23a2a` `chore(task): archive 08-02-planning-view`
  - `170ce6f` `chore: record journal`
  - `f8d15d1` `chore: 启用 Codex 子代理调度`
- 本文提交后应已推送到 `origin/main`；新机器先用 `git log --oneline -8` 确认。

## 二、M6 当前进度

- 父任务 `08-02-content-planning-workbench`：`in_progress`，任务树显示 `[1/3 done]`。
- 子任务① `08-02-spec-edit-and-history`：代码已完成，提交 `51a1823`；仍显示
  `in_progress` 是旧流程留下的状态问题，不要重做。
- 子任务② `08-02-planning-view`：**实现、检查、规范更新、付费真机走查均已完成并归档**。
  全仓测试共 **877 条**通过；真实走查只付费重生成 1 页，确认新 `reference_text` SHA、
  新规格指纹生效，未选页字节不变。
- 子任务③ `08-02-planning-conversation`：`planning`，目前只有父任务播种的 `prd.md`。
  **这是下一步。先完成 Phase 1 的需求收敛、设计、实施计划与上下文配置；未经用户审阅
  和 `task.py start`，不要进入实现。**

当前父任务之所以仍是 current，是会话回退定位结果；不表示还要继续实现父任务或子任务②。

## 三、新机器第一轮命令

```bash
git clone https://github.com/nuts2k/ppt-maker.git
cd ppt-maker
git log --oneline -8

cp .env.example .env
# 填 OPENAI_API_KEY / OPENAI_BASE_URL
pnpm install
pnpm build
node apps/cli/dist/index.js doctor
pnpm -r test                   # 期望 877

python3 ./.trellis/scripts/task.py list
python3 ./.trellis/scripts/get_context.py
```

若仓库已经存在，用 `git pull --ff-only` 代替 clone。拉取后若出现 core 导出相关的假 typecheck
错误，先执行 `pnpm --filter @ppt-maker/core build`；真机命令依赖 CLI 时再执行
`pnpm --filter @ppt-maker/cli build`。

然后读取并继续：

1. `.trellis/tasks/08-02-planning-conversation/prd.md`
2. 父任务 `.trellis/tasks/08-02-content-planning-workbench/prd.md` 与 `design.md`
3. `.trellis/spec/backend/contracts.md` 中“模型可提案、不可直接落盘”一节
4. 用 `trellis-brainstorm` 完成子任务③ Phase 1；规划完成后交用户审阅

## 四、子任务③不要重新论证的边界

- 多轮提问与对话式改稿是本轮增量；不要重做 M5 的单轮 `spec-draft`。
- 策划提问与改稿提案是两个模型面，不能共用 schema。
- 模型只能提案，不能直接写 `content-spec.json`；用户确认后必须复用
  `applySpecChange` 统一入口。
- 提案是完整替换条目，不是 patch；`specId`、`specEntryId`、时间戳由代码分配。
- 被拒绝的提案仍写 `planning/session.jsonl`，但规格文件必须字节不变。
- 五维度进度必须能从会话文件重建；一个 deck 一条会话流，不跨 deck 复用。
- 背景材料本轮只收纯文本 / Markdown，副本落 `planning/materials/`；不做 PPTX、DOCX 解析。
- `style` 仍是单个 `description`，不改 `ContentSpecSchema`、指纹口径、生成提示词或
  `SCHEMA_VERSION`。

## 五、不在 Git 里的内容

换机器时仍需单独带走：

- `.env` 中的 `OPENAI_API_KEY`、`OPENAI_BASE_URL`
- `~/test/` 下至少三个 deck：`wt4-spec-2026-08-02`、`wt4-append`、
  `ppttest-2026-07-25`
- 如新机器缺失，按 8 月 2 日接续文档恢复 Swift 原生二进制与字体/PowerPoint 环境

注意：`wt4-spec-2026-08-02/page-04` 的基线本来就是 `drifted`。任何付费批量重生成前，
先跑 `deck status --json` 核对实际页集合，并再次向用户确认调用次数与不可撤销性。

