# 会话交接：M5 父任务规划已完成，未启动

写于 2026-07-31 规划会话结束时，供新会话接续。

## 立刻做这一步

新会话的 Trellis SessionStart 很可能显示 `Current task: none`——活动任务是按会话 id 绑定的
（本次为 `session:claude_4011e303-…`），换会话后不会自动指向。先重新指向本任务：

```bash
python3 ./.trellis/scripts/task.py current --source
```

若不是 `.trellis/tasks/07-31-page-sources-and-content-generation`，直接读本目录的
`prd.md` → `design.md` → `implement.md` 三份文档即可接续，不要重新规划。

## 当前状态

- 任务状态：`planning`，**尚未 `task.py start`**
- 规划产物：`prd.md`、`design.md`、`implement.md` 三份齐备并已交叉核对一致
- 上下文清单：`implement.jsonl` 3 条、`check.jsonl` 3 条，均为真实条目（非种子）
- 子任务：**尚未创建**（`task.json` 的 `children` 为空），按计划在阶段一之后创建
- 代码改动：**零**。本次会话只写了任务目录下的规划文档，仓库其余部分未动

## 用户已拍板的七条决策

D1–D7 全部记在 `prd.md` 的「已定决策」表里，含结论与影响。不要重新提问，
除非实现中发现决策前提不成立——那种情况回父任务改决策，不要在实现里绕过。

其中 D6、D7 是用户在规划后段追加的，也是最容易被漏掉的两条：

- **D6**：`generated` 页批量生成后必须逐张人工确认才走 `ocr`，`imported` / `extracted`
  自动放行。落地为第三个验收闸门 `accept-source`。
- **D7**：规格双层（deck 级可编辑意图 + slide 级不可变快照），规格改动只产生只读漂移标注、
  不自动失效阶段；调整主路径是「重生成时附带一句说明」并回写规格条目。

## 下一步：执行 `implement.md` 阶段一

审阅已通过口径由用户在上一会话给出（「文档我就不细看了」+ 两轮追加需求后未再提异议）。
新会话可直接：

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/07-31-page-sources-and-content-generation
```

然后按 `implement.md` 阶段一执行 ROADMAP 对齐（1.1–1.5 五项），**先不要碰产品代码**。
阶段一提交后再创建子任务 ①：

```bash
python3 ./.trellis/scripts/task.py create "<标题>" --slug <slug> \
  --parent 07-31-page-sources-and-content-generation
```

## 三个必须带进下一会话的判断

这三条是本次规划中代价最高的推理，重述一遍以免在子任务里被推翻或遗忘。

**1. `accept-source` 是唯一允许新增的阶段，且只因为它是验收闸门。**
`ArtifactAcceptance` 已是通用验收契约（`.trellis/spec/backend/contracts.md:241,257`），
`accept-clean` / `accept-pptx` 是它的两个实例。阶段图对三种来源**完全相同**，
差别只在 `accept-source` 的初始状态。若子任务发现还需要新增**处理阶段**（非验收闸门），
说明来源抽象没成立，回父任务重新决策。

**2. RK4 是本任务的头号风险，且它推翻了「零迁移」的承诺。**
新增阶段会让旧 manifest 撞上「所有 `SlideStage` 都必须有对应状态」的校验
（`packages/core/src/workspace-contracts.ts:249`），**旧工作区会直接加载失败**。
子任务 ① 必须让加载期归一化与契约字段同批落地，且旧 manifest 加载回归测试是准入条件。

**3. 自动放行不得伪造人工痕迹。**
`imported` / `extracted` 的 `accept-source` 置 `completed` 但**不写** `accepted.json`。
写一条 `acceptedBy` 指向系统的验收记录，等于让报告声称「这页源图有人确认过」而事实没有——
这正是 M4 列为头号风险的「记录与事实相反」。

## 一个未验证的可行性前提

**RK1**：`images.generate` 能否直出 16:9（2048×1152）**没有验证过**。现有
`images.edit` 用的该尺寸走的是 SDK `(string & {})` 自由通道（`openai-image.ts:52`
注释自陈无字面量校验），不构成 generate 也支持的证据。

子任务 ③ 的第一步必须是实调验证。**验证失败就停下回父任务**，不要在实现里自行选择
裁剪自产图或换 Provider——那是需要用户拍板的产品决策。此时 ①② 已完成且不依赖 ③，
可以只交付两种来源，M5 完成条件相应调整。

## 已知仍待定的（留给子任务 brainstorm，不是遗漏）

- RK2 生成图的跨页风格一致性方案 → 子任务 ③
- 内容规格的具体形状（定稿即冻结为跨里程碑契约）→ 子任务 ③
- `text_review` 清空的实现口径（移除资产记录 vs 按 attempt 归档）→ 子任务 ①，
  `design.md` §4.3 已列出两个可接受方向与硬约束
- 批量源图确认界面的交互形态 → 子任务 ④
