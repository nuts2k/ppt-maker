# 策划对话：提问收敛与对话式改稿（M6 子任务③）

## Goal

把已完成的 `planning` 规格工作台接上模型：从一句构思出发，经多轮提问收敛出可执行规格；
对已有规格则用自然语言产生可审阅提案，用户看完逐字段 diff 并确认后才由代码写盘。

用户价值是全程不手写 JSON，同时保留最终控制权、可追溯性与 M5 的漂移真实性。

## Background

M5 已交付“一句构思 → 规格初稿”的一次性、无对话版本：CLI `deck spec-draft`、桌面端
SourcePicker 和 `apps/cli/src/providers/openai-spec-draft.ts`。本任务的增量是**多轮提问、
对话式改稿、会话恢复与背景材料**，不重做单轮初稿。

子任务②已完成并归档。现有工作台是左历史、右规格编辑器的固定骨架
（`apps/desktop/src/renderer/pages/PlanningPage.tsx:219`、`:225`）；右侧使用 `saved` / `draft`
双态，显式保存经 `window.api.deck.applySpecChange`
（`apps/desktop/src/renderer/stores/planning-store.ts:9`、`:91-101`）。本任务在左栏增加
“对话 / 历史”切换，出现提案时复用右栏展示 diff，不重新设计页面骨架。

main 当前手工保存把来源固定为 `manual`（`apps/desktop/src/main/ipc/deck.ts:426`）。提案接受
必须走独立调用，向唯一写入入口传 `origin: "proposal"` 与 `conversationRef`，不得把模型改稿
伪装成手工保存。

## Phase 1 Decisions

| # | 主题 | 决策 | 依据 |
|---|---|---|---|
| E1 | 手工草稿与提案 | 已有规格存在未保存手工草稿时，禁止发起模型改稿；必须先保存或放弃。无权威规格的从零策划不受此限制 | 防止覆盖草稿；一条历史只属于 `manual` 或 `proposal` 一种来源 |
| E2 | 初稿接受 | 整份初稿先作为只读完整提案展示，整体接受后立即以 `proposal` 落盘；接受前不进入手工编辑态 | 原始提案、会话和首条规格历史一一对应 |
| E3 | 背景材料 | 材料是 deck 级长期背景；导入后自动参与每次调用，重开仍生效，移除副本后停止使用 | deck 自包含、可重放；接受持续 token 成本 |
| E4 | 全 deck 改写 | 一次模型调用返回整份原子提案；超限则整次失败，不自动拆成逐条调用 | 保持跨页一致、调用次数明确，避免部分成功 |
| E5 | 待确认提案 | 同时只允许一份 pending；必须接受或拒绝后才能继续发送消息 | 保证 diff 与过时预告基于稳定规格，不引入重基与冲突 |

## Parent-Owned Boundaries

以下跨子任务契约由父任务 `.trellis/tasks/08-02-content-planning-workbench/design.md` 独占；
本任务只实现，不自行改口径：

1. 规格写入统一入口与变更日志落盘时机（父 design §2、§3）；
2. `SpecChangeRecord` 与追加式 `PlanningSessionRecord` 形状（父 design §3.2、§5）；
3. `SpecProposalSchema` 与“提案 ≠ 变更”流程（父 design §4）；
4. D5 对 M5 D7 的放宽：“模型可提案、不可直接落盘”（父 design §6；已收录于
   `.trellis/spec/backend/contracts.md`）。

Phase 1 核对发现旧 `PlanningMessage.acceptedAs` 与“提案出现即追加”的要求不能同时成立：纯追加
文件无法后来回写原行。父 design §5 已收敛为“消息记录 + 提案决策记录”的联合类型，接受与拒绝
均通过新行表达；这保持了原产品语义并使重开恢复可实现。

## Requirements

- **C1 策划提问**：模型自由提问并输出受众 / 场景 / 篇幅 / 结构 / 风格五维度状态；维度可为
  已收敛、待补充或不适用。界面显示进度，用户随时可“就按现有信息出初稿”。
- **C2 会话恢复**：`<deck>/planning/session.jsonl` 追加写，一个 deck 一条流，不跨 deck 复用；
  消息、五维度、提案与接受/拒绝状态都能从文件重建。
- **C3 初稿提案**：从零策划产生完整、只读规格提案；整体确认前不写 `content-spec.json`，
  确认后由代码分配 / 保留 id 并走 `applySpecChange`。
- **C4 改稿提案**：作用域分单条目 / 全 deck，单条目默认。模型输出替换后的完整条目而非 patch；
  全 deck 一次原子调用。全 deck 可在确认时取消 style 或个别条目，单条目整体接受或拒绝。
- **C5 diff 与影响预告**：提案逐字段展示 before / after；用 `previewSpecChange` 明确写出确认后
  新增多少过时页与失联页，用户确认后才落盘。
- **C6 单 pending 与手工草稿隔离**：落实 E1 / E5；界面和领域层均不得允许绕过。
- **C7 提案留痕**：提案先写会话再展示；被拒绝提案仍可查，规格字节不变；接受后
  `SpecChangeRecord.conversationRef` 指向提案消息。
- **C8 背景材料**：导入纯文本 / Markdown 副本到 `<deck>/planning/materials/`；全部当前材料自动
  进入每次模型调用，列表可移除副本。`.pptx` / `.docx` / 笔记解析不在本轮。
- **C9 失败可追溯**：provider refusal、空解析、无效 schema、材料读取失败、会话追加失败均明确
  报错；不得把自由文本当规格，不得返回未留痕的可接受提案。
- **C10 兼容性**：`planning/` 不存在时读为空且零写盘；删除整个目录后生成主链路照常；旧 deck
  不迁移、不因只读打开而改写。

## Model and Contract Constraints

- 策划提问与改稿提案不共用 schema；初稿输出复用既有 `ContentSpecDraftSchema`。
- 沿用 Responses API + `zodTextFormat`，`store: false`。
- 模型面 schema 不带 `minLength` / `refine`；落盘前必须经完整 `ContentSpecSchema.parse`。
- 外部响应先 `safeParse`；refusal 或解析为空时抛 `INVALID_PROVIDER_RESPONSE`。
- `specId`、`specEntryId`、时间戳始终由代码分配 / 保留；模型给出的未知 id 不可信。
- 第三方网关不返回 request id 时如实记 `null`，不伪造、不拿其它 id 顶替。
- `ContentSpecSchema`、`specViewFingerprintValues`、`buildPageGenerationPrompt`、
  `SCHEMA_VERSION` 在本任务内保持不变。

## Acceptance Criteria

- [ ] **A1** 从一句构思出发，经至少两轮问答生成初稿、整体接受、建页并走到 `deck run --strict`
      PPTX；全程不手写 JSON。
- [ ] **A2** 已有规格可按单条目与全 deck 两档对话式改稿；接受后对应条目变化，M5 如实报漂移，
      不自动失效任何阶段。
- [ ] **A3** 初稿与改稿确认前均显示逐字段 diff；确认文案给出确切新增过时 / 失联页数。
- [ ] **A4** 被拒绝提案前后 `content-spec.json` 字节一致，`session.jsonl` 同时查得到提案和
      rejected 决策。
- [ ] **A5** 接受提案写出 `origin: "proposal"`，`conversationRef` 可回到原消息；模型自造未知 id
      不进入规格。
- [ ] **A6** 重开工作台后消息、五维度、材料和唯一 pending / accepted / rejected 状态一致；
      切 deck 不串会话，迟到响应不污染新 deck。
- [ ] **A7** 存在未保存手工草稿或 pending 提案时，对应模型动作被阻止并给出明确下一步。
- [ ] **A8** 材料导入后每轮自动生效，移除后停止使用；原始文件不被改动；不接受二进制格式。
- [ ] **A9** 删除 `<deck>/planning/` 后 `status` / `run` / `export` 主链路照常；无 planning 的旧 deck
      只读打开零副作用。
- [ ] **A10** 任何后续图像生成仍在事前确认中写明调用次数与不可撤销；本任务的文本模型调用不得
      绕过既有 provider 错误与追踪纪律。
- [ ] **A11** 测试基线不低于当前 **877**，新增 core / CLI / desktop 能力均有对应测试；异步身份
      守卫、拒绝零写盘等关键断言做过变异验证。

## Out of Scope

- 重做 M5 单轮 `deck spec-draft` 或改变其 CLI / SourcePicker 行为。
- `.pptx`、`.docx`、笔记解析；材料启用清单、逐轮附件或外部知识库。
- 同时保留多份待确认提案、提案重基、多人协同或规格并发编辑保护。
- 全 deck 自动拆成逐条目 N 次调用；若真实超限率不可接受，本轮回滚为只保留单条目。
- 自动重生成图像；规格接受只产生漂移，付费重生成仍由现有清单与确认门控制。
- 改生成提示词、规格 schema、指纹口径、全仓版本或 style 的单字段形态。

## Dependencies and Validation Inputs

- 子任务① `08-02-spec-edit-and-history`：`applySpecChange`、`previewSpecChange`、变更历史。
- 子任务②归档任务 `08-02-planning-view`：planning 页面、手工编辑、历史与批量重生成。
- 真实素材 `~/test/wt4-spec-2026-08-02` 只通过 scratchpad 副本使用；其 page-04 基线本来就是
  `drifted`，任何付费重生成前先跑 `deck status --json` 并重新确认实际调用次数。
