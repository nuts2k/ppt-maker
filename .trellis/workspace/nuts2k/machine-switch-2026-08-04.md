# 换机器接续说明（2026-08-04，晚间最终版）

**新机器 / 新会话先读这一份。** 更早文档只补充历史与非 Git 环境细节：

- [machine-switch-2026-08-02.md](./machine-switch-2026-08-02.md)：`.env`、原生二进制、真实 deck 与 AI 会话目录。
- [machine-switch-2026-08-03.md](./machine-switch-2026-08-03.md)：M6 子任务①之后的技术决策与真实 deck 基线。
- [m6-handoff-2026-08-03.md](./m6-handoff-2026-08-03.md)：规格编辑 / 历史底座的符号和硬约束。

## 一、交接时 Git 状态

- 分支：`main`
- 交接前工作区：干净
- 远端：`origin = https://github.com/nuts2k/ppt-maker.git`
- 本轮关键提交：
  - `5d83edf` `feat(m6): 实现策划对话与提案改稿`
  - `fd8a4eb` `docs(m6): 记录策划对话真机验收`
  - `e68722f` `chore(task): archive 08-02-planning-conversation`
  - `dd13d15` `chore: record journal`
- 本文更新后会另有一条换机文档提交，并全部快进推送到 `origin/main`。

新机器先确认：

```bash
git status -sb
git log --oneline -8
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

`HEAD` 与远端 main 应一致，工作区应干净。已有仓库使用 `git pull --ff-only`，不要 merge pull。

## 二、M6 当前真实进度

- 父任务 `08-02-content-planning-workbench`：`in_progress`，任务树显示 **2/3 done**。
- 子任务② `08-02-planning-view`：实现、付费走查、归档均完成。
- 子任务③ `08-02-planning-conversation`：实现、独立终审、真实模型 / 图像 / strict PPTX 走查、归档均完成。
  - 全仓测试基线：**948**（core 156 / CLI 265 / desktop 527）。
  - 真实文本调用：两轮策划提问、一次初稿、一次单条目改稿，均为 `gpt-5.6-luna` 且有 `resp_*` requestId。
  - 最小一页真实链路：页面生成 → OCR / AI 复核 → 人工修正 → clean 重试 → 原生 PPTX → `export --strict`。
  - 图像代理不返回 requestId，按契约保持 `null`；1672×941 的“尺寸异常”是既有已知口径，保持 16:9 且与源图同尺寸。
- 子任务① `08-02-spec-edit-and-history`：代码与真实走查早已完成（提交 `51a1823`），但旧流程遗留为
  `in_progress`，所以父任务仍显示 2/3。**不要重做代码。**

### 明天真正的下一步

1. 先把子任务①重新设为 current，只核对其既有提交 / AC / 工作区状态，确认无缺口后归档：

   ```bash
   python3 ./.trellis/scripts/task.py start .trellis/tasks/08-02-spec-edit-and-history
   python3 ./.trellis/scripts/get_context.py
   ```

   使用 `trellis-continue` 接回正确 Phase；目标是收尾旧状态，不是重新实现。

2. 子任务①归档后，父任务应变为 3/3。再对 `08-02-content-planning-workbench` 做一次父级集成验收、
   回写父 PRD 证据并归档。
3. 最后回到 `07-20-ppt-maker-mvp-roadmap`，确认 M6 完成后的下一里程碑，不要在没有任务规划时直接开新代码。

## 三、新机器落地步骤

```bash
git clone https://github.com/nuts2k/ppt-maker.git
cd ppt-maker

# 推荐 Node 24 LTS；项目约束 >=24 <25
corepack enable
pnpm --version                         # 期望 10.32.0

cp .env.example .env
# 手工填 OPENAI_API_KEY / OPENAI_BASE_URL，禁止提交 .env

pnpm install --frozen-lockfile
pnpm build                             # 含 Swift OCR + PDF renderer
node apps/cli/dist/index.js doctor
pnpm test                              # 期望 89 文件 / 948 项

python3 ./.trellis/scripts/task.py list
python3 ./.trellis/scripts/get_context.py
```

若 `core` 导出导致 typecheck 假失败，先跑：

```bash
pnpm --filter @ppt-maker/core build
pnpm --filter @ppt-maker/cli build
```

CodeGraph 索引不进 Git；当前 worktree 首次使用前运行：

```bash
codegraph init -i
```

## 四、必须手工迁移的内容

Git 不包含以下内容：

1. `.env`：`OPENAI_API_KEY`、`OPENAI_BASE_URL`。
2. `~/test/` 最小真实数据：
   - `wt4-spec-2026-08-02`
   - `ppttest-2026-07-25`
   - `wt4-append`
   - `planning-conversation-live-2026-08-04`（31M，本轮真实策划、改稿、clean 重试与 strict PPTX 证据）
3. Swift `.build/` 无需拷贝，`pnpm build` 会重建；但新机器必须安装 Xcode Command Line Tools。
4. Microsoft PowerPoint for Mac 与 Microsoft YaHei 字体需另装；`doctor` 会检查。

本轮证据已从易失的 `/tmp` 复制到：

```text
~/test/planning-conversation-live-2026-08-04/
```

其中 `planning-live-strict.pptx` 是最终 1 页 strict 导出，`zero-deck/` 是完整链路，`edit-deck/`
是真实规格改稿副本。原始 `~/test/wt4-spec-2026-08-02` 聚合哈希前后均为
`45371c7ecee3a9ccc61ea2b378d62648d2b45e10`。

## 五、新会话不要重新论证的结论

- 模型只产生提案；确认后统一走 `applySpecChange(origin="proposal", conversationRef=messageId)`。
- 策划提问、初稿、改稿是独立 Provider 面；模型 schema 无约束，持久化前跑完整 Zod。
- 初稿整体接受；单条目不能改 deck style；全 deck 一次原子调用且可取消部分选择。
- 会话是 `PlanningMessage | PlanningProposalDecision` 追加流；同一提案第一条有效 decision 为准。
- accepted decision 写失败时，以 spec-history 的 `origin + conversationRef` 在只读投影中恢复；无证据不猜。
- 同一 deck 只有一份 pending；手工 dirty 时禁止模型改稿；材料是 deck 级 `.md` / `.txt` 长期背景。
- `planning/` 是可删旁路；删除后 `status`、`run`、`export --strict` 已经真机验证仍可用。
- `ContentSpecSchema`、指纹、生成 prompt、`SCHEMA_VERSION` 均未改变。

## 六、跨会话记忆

Git 已包含任务归档、后端 / 前端 spec 和 `.trellis/workspace/nuts2k/journal-1.md`（Session 9）。
原始 Codex / Claude 对话不随 Git 迁移；若需要在新机器继续用 `trellis mem` 搜完整原话，另行迁移
对应平台的本机会话目录。普通续接优先相信 Git 中的归档任务、spec 与本文件，不必依赖聊天日志。

当前 `trellis mem` 有一条已知限制：OpenCode 1.2+ 的 SQLite 日志暂不可读；Codex / Claude 不受影响。
