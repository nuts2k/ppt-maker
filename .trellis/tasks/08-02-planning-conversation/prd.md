# 策划对话：提问收敛与对话式改稿（M6 子任务③）

> 本文由父任务 `08-02-content-planning-workbench` 在阶段一播种，只写**目标与边界**。
> Requirements / Acceptance 是父任务下发的种子，子任务自行走 Phase 1 细化，
> 并按需补 `design.md` / `implement.md` 后再 `task.py start`。

## Goal

把子任务②的 `planning` 视图接上模型：从一句构思出发**多轮提问收敛**出规格初稿，
并让已有规格能用自然语言改稿——模型**提案**，界面 diff，用户确认，代码写盘。

**M5 已经交付了「一句构思 → 规格初稿」的一次性、无对话版本**
（CLI `deck spec-draft --from <文本>`、桌面端 SourcePicker 的「从构思文本产初稿」、
Provider `apps/cli/src/providers/openai-spec-draft.ts`）。本任务的增量是**多轮**与**改稿**，
不是重做初稿生成。

## 边界引用（父任务独占，本任务不得自行修改）

改动以下四项须**回父任务改**：

1. 规格写入统一入口与变更日志的落盘时机 — 父任务 `design.md` §2、§3
2. `SpecChangeRecord` 与 `PlanningMessage` 的记录形状 — 父任务 `design.md` §3.2、§5
3. `SpecProposalSchema` 的提案形状与「提案 ≠ 变更」的落盘流程 — 父任务 `design.md` §4
4. **D5 对 D7 的放宽口径** — 父任务 `design.md` §6，已收录于
   `.trellis/spec/backend/contracts.md`〈模型可提案、不可直接落盘〉。**本任务是这条口径的
   主要落地点，动手前先读那一节**，尤其是「放宽后仍成立的三条」。

## Requirements（父任务下发的种子，子任务 Phase 1 细化）

- **C1 策划提问 provider**（D6）：模型自由提问、可把维度标「不适用」；
  界面显示受众 / 场景 / 篇幅 / 结构 / 风格五项收敛进度；
  用户随时可「就按现有信息出初稿」。**纯自由对话看不见进度，固定问卷会重复问构思文本已写明的维度。**
- **C2 会话落盘**：`<deck>/planning/session.jsonl` 追加写，一个 deck 一条会话流，
  切 deck 即切文件，**不跨 deck 复用会话**。
  **维度状态必须可从会话文件重建**——否则重开工作台后进度条归零而对话内容还在，两者不一致。
- **C3 改稿提案与 diff 确认**（D5）：模型输出**替换后的完整条目**（不是 patch）→
  界面逐字段 diff → 用户确认后由代码写盘，走子任务① 的 `applySpecChange`。
  作用域分「单条目 / 全 deck」两档，**单条目是默认路径**。
- **C4 确认前预告过时范围**：用 `specViewFingerprint` 预算提案落盘后的新指纹，
  与各页 `source.specEntrySha256` 比对，明确写出「确认后 N 页变为已过时」。
  这是选「全量条目」而非「patch」的直接收益，**不得省略**。
- **C5 提案先留痕再落盘**：提案在确认前**不写** `content-spec.json`，
  但**要写** `session.jsonl`（含被否决的提案）。规格文件只反映被接受的结果。
- **C6 背景材料输入**（父任务 R7）：纯文本 / Markdown 文件可作为策划的背景材料喂入，
  副本落 `<deck>/planning/materials/`。`.pptx` / `.docx` / 笔记的解析按 D1 **后置，本轮不做**。

## 模型交互的既有约束（照抄既有教训，别再踩一遍）

- 两个模型面**不共用 schema**：策划提问（回应 + 五维度收敛状态 + 下一个问题 / 可以出稿）
  与改稿提案（回应 + 替换后的完整条目）形状不同。
- 沿用 `openai-spec-draft.ts` 的模式：Responses API + `zodTextFormat`，`store: false`。
- **模型面 schema 一律无约束**：Structured Outputs 的 JSON Schema 不接受 `minLength`
  与自定义 `refine`，带约束的 schema 直接喂 `zodTextFormat` 会被 API 拒绝
  （教训写在 `packages/core/src/content-spec-contracts.ts`）。约束在落盘前由
  `ContentSpecSchema.parse` 补齐——一条不少，只是校验位置挪到写入侧。
- 外部响应先经 `safeParse` 再使用；模型 refusal 或解析为空时**不得**把自由文本当规格。
- `specEntryId` / `specId` / 时间戳**始终由代码分配**，模型给出的一律丢弃重分配。
- 模型调用的 `requestId` 恒为 `null` 是**已知非缺陷**（第三方网关不回传 `x-request-id`），
  **如实记 `null`，不伪造、不用其它 id 填充**。

## Acceptance Criteria（种子）

- [ ] 从一句构思出发，经多轮问答产出规格，**全程不手写 JSON**，
      最终能 `deck run` 到 `--strict` PPTX（父任务 A1）
- [ ] 逐页内容可对话式改，改动落到对应条目，M5 侧如实报漂移，
      **不自动失效任何阶段**（父任务 A2）
- [ ] 被否决的提案：`content-spec.json` 字节不变，但 `session.jsonl` 里查得到
- [ ] 重开工作台后五维度收敛进度与对话内容一致（可从会话文件重建）
- [ ] `rm -rf <deck>/planning/` 后所有主链路功能照常（父任务 A5）
- [ ] 任何会发起图像生成的动作，事前确认都写明调用次数与不可撤销（父任务 A8）
- [ ] 测试基线不低于 774，新增能力有对应用例（父任务 A9）

## 依赖

**子任务① `08-02-spec-edit-and-history`**（提案落盘复用它的统一写入入口）与
**子任务② `08-02-planning-view`**（对话区与 diff 确认挂在它的视图里）。

## Notes

- 风险 RK-M6-2：若「全 deck 改写」因上下文超限失败率高，回滚点是**只保留单条目作用域**，
  全 deck 改写降级为「逐条目串行提案」，**不改 D5**。
- 真实素材：`~/test/wt4-spec-2026-08-02`（M6 直接输入）。A1 走新建空 deck 的路径。
