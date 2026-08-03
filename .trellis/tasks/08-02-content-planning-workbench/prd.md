# M6 内容策划工作台（父任务）

## 目标

把「一句构思」变成一份可执行的内容规格，让 `generated` 来源不必手写规格文件，
且逐页内容可对话式调整、调整落盘为规格条目变更、M5 侧如实反映漂移。

父任务只拥有**跨子任务契约**（变更日志 schema、模型提案 schema、D7 放宽口径、
planning 会话文件布局）、任务地图与最终集成验收；实现全部在三个子任务中完成。

## 背景与现状（代码事实）

M6 不是从零起步。M5 子任务③ 已把「构思 → 规格」的**一次性、无对话**版本做完并上线：

| 已有能力 | 位置 | 形态 |
|---|---|---|
| 内容规格契约（冻结） | `packages/core/src/content-spec-contracts.ts` | 双层：deck 级 `style` + 条目数组 |
| 条目指纹 / 漂移口径 | 同上 `specViewFingerprintValues:143` | 显式列字段；覆盖 `style` + 条目全部字段 |
| 一次性初稿生成 | `apps/cli/src/deck/spec-draft.ts`、`providers/openai-spec-draft.ts` | Responses API + `zodTextFormat`，单轮无对话 |
| CLI 入口 | `apps/cli/src/index.ts:706` | `deck spec-draft --from <文本> -o <json>` |
| 桌面端入口 | `renderer/components/console/SourcePicker.tsx:542` | 「选已有规格文件」/「从构思文本产初稿」两档 |
| 规格读入 IPC | `main/ipc/deck.ts:300`、`:323` | 复用 CLI 的 `readContentSpecFile`，含 schema 校验 |
| 单页调整说明 | `renderer/pages/SourceReviewPage.tsx:568` → `deck regenerate --note` | 只能**追加** `revisionNotes`，看不见已累积条目、无法删除 |
| 对账与漂移 | `apps/cli/src/deck/content-spec.ts:141` `reconcileDeckSpec` | 新增 / 失联 / 漂移三类；只补新增，不双向同步 |
| 改文字后的基准同步 | `apps/cli/src/slide/replace-source.ts:70` | 重生成时写入新 `reference_text` 资产并把新 sha 计入指纹 |
| 零页 deck | `apps/cli/src/deck/workspace.ts:210` `createEmptyDeckWorkspace` | 已支持 `slides: []` |

`SourcePicker.tsx:43` 与 `:675` 两处注释显式把「编辑规格条目」留给 M6，界面文案是
「规格条目的编辑请直接改那个 JSON 文件」。初稿列表只显示 `pageType` + 标题，
`textGroups` / `visualIntent` / `style` 在界面上不可见也不可改。

因此 M6 的真实增量是：多轮提问收敛、对话式改稿、规格可见可编辑、变更可追溯、
已过时页的批量重生成入口。

### 决定形态的四个结构事实

1. **出图依据分五层**（`providers/page-generation.ts:34` `buildPageGenerationPrompt`）：
   ①引导语（代码常量，含 16:9 硬约束）、②deck 风格、③条目、④`revisionNotes`、⑤铁律（代码常量）。
   只有 ②③④ 在契约里、进指纹。拼接顺序即优先级，④ 靠「后出现的指令权重更高」生效（E4）。
2. **`style` 是一整段散文**（`ContentSpecStyleSchema` 只有 `description: string`），做不出分项控件。
3. **`textGroups` 有双重身份**：既进提示词，又经 `flattenSpecEntryTexts` 展平为该页 `reference_text`，
   即下游 OCR 复核的文字真值基准。改文字＝改整条流水线的比对基准。
4. **改 `style` 的爆炸半径是 deck 级**：它拼进每一页，改它意味着所有已生成图都过时。
5. **`SCHEMA_VERSION = 1` 是全仓共用常量**（`packages/core/src/constants.ts:1`），
   manifest / stage-graph / workspace / pptx / clean / content-spec 全用 `z.literal(SCHEMA_VERSION)`。
   契约注释所称「content-spec 有自己的版本轴」在实现上**不成立**；升版本＝全仓迁移。

## 已定决策

| # | 主题 | 决策 | 依据 |
|---|---|---|---|
| D1 | 本轮纵深 | 交付「编辑底座 + 对话式改稿 + 多轮提问收敛」；输入通道只收纯文本 / Markdown，`.pptx` / `.docx` 解析后置 | 对话改稿的落点就是编辑器呈现的字段，无底座则模型改完既验证不了也回滚不了；二进制解析引入新依赖且不在完成条件里 |
| D2 | `style` 形态 | **不拆**结构化子字段，维持 `description: string`；界面给大文本框 + 引导式问答合成 + 模型辅助改写（确认后落盘） | 下游吃的就是散文，拆完仍要拼回文本；升版本＝全仓迁移违反零迁移承诺；加可选字段则须在指纹里做条件包含，破坏「显式列字段」纪律。真正痛点是「看不见」不是「不能分项改」 |
| D3 | 工作台形态 | 桌面端新增独立视图 `planning`（`ui-store.ts:11` 的 `AppView` 第四项），左对话右规格 | 长驻工作面塞不进一次性模态；独立视图同时服务「新建前策划」与「已有 deck 改规格」，模态只覆盖前者。M5 ④ 新增 `source-review` 是同类先例 |
| D4 | 草稿落点 | 先建空 deck，`content-spec.json` 从第一刻起在 deck 根，对话记录落 deck 内 | `reconcileDeckSpec.newEntries` 语义正是「规格里有、deck 里还没建页」，「空 deck + 完整规格」是既有链路已实现的合法起点；deck 自包含可重放是 M1 起的核心设计；单一存储避免两地同步 |
| D5 | 改稿落盘 | 模型输出**替换后的完整条目**（结构化）→ 界面逐字段 diff → 用户确认后由代码写盘，确认前预告「这会让哪几页过时」。**显式放宽 D7 为「模型可提案、不可直接落盘」** | patch 语义是模型高错区且 zod 难表达；全量条目复用 `openai-spec-draft.ts` 成熟模式并让指纹可预计算。D7 保护的实质是「不被静默改写、用户有最终控制权」，该实质不变 |
| D6 | 提问形态 | 模型自由提问、可把维度标「不适用」；界面显示受众/场景/篇幅/结构/风格五项收敛进度；用户随时可「就按现有信息出初稿」 | 纯自由对话看不见进度；固定问卷会重复询问构思文本已写明的维度 |
| D7 | 版本与追溯 | deck 内**追加式变更日志**：每条存变更前后条目全量、触发来源、新旧指纹、时间戳。回滚＝重写前值并追加新记录。**定位为旁路**，删除不影响功能，CLI 不读它 | 条目级可追溯要的是「谁在何时因哪句话改了这一条」，全量快照只能靠 diff 反推且丢掉理由；条目很小，存前后全量后回滚是纯派生 |
| D8 | ①⑤与调用参数 | **不开放**，保持代码常量；工作台只管 ②③④ | 开放即撞死结：不进指纹则静默过时，进指纹则须扩契约（与 D2 冲突）。⑤ 那句 `Render every listed text exactly as written…` 是 `reference_text` 能当 OCR 真值的前提；① 里的 16:9 是硬约束 |
| D9 | 已过时页 | 工作台列出全部已过时页，默认全选、可逐页取消，一次付费确认后批量重生成 | 不给批量入口等于把 D2 省下的复杂度转嫁成用户点 N 次；自动重生成既花钱又覆盖已人工验收的产物，与 M5 付费门槛纪律相悖 |

> D5 的放宽必须回写 `.trellis/spec/` 与 ROADMAP，否则后来者按 M5 父任务 `prd.md:44`
> 的「不引入模型改写」会判定本里程碑违规。

## 需求

- **R1 planning 视图**：新增 `AppView` 第四项，两个入口——从空态新建策划、从已打开 deck 改规格。
- **R2 多轮提问收敛**：模型按 D6 逐项发问并收敛，产出规格初稿；全程可随时出稿。
- **R3 规格逐字段可编辑**：`style.description`、`pageType`、`textGroups`（分组与条目增删改）、
  `visualIntent`、`revisionNotes`（**可见且可删除**——补上 M5 留下的「只能追加、看不见已累积条目」缺口）。
- **R4 对话式改稿**：按 D5 走提案 → diff → 确认落盘；作用域分「单条目 / 全 deck」两档。
- **R5 变更日志与回滚**：按 D7 落盘、可回看、可回滚。
- **R6 已过时页批量重生成**：按 D9 走清单 + 勾选 + 一次付费确认。
- **R7 背景材料输入**：纯文本 / Markdown 文件可作为策划的背景材料喂入。
- **R8 零页 deck 中间态**：控制台与 `deck status` 对「有规格、零页」的 deck 如实显示且不报错。

## 验收标准（跨子任务，父任务负责最终集成审查）

- **A1** 从一句构思出发，经多轮问答产出规格，全程不手写 JSON，最终能 `deck run` 到 `--strict` PPTX。
- **A2** 逐页内容可对话式改，改动落到对应条目，M5 侧如实报漂移（不自动失效任何阶段）。
- **A3** 工作台能打开**已有 deck** 的 `content-spec.json` 并完成全部编辑，含 `revisionNotes` 的删除。
- **A4** 改 `style` 后所有生成页报漂移且清单列全；勾选后批量重生成，**未勾选的页字节不变**。
- **A5** 变更日志可回看、可回滚；**删除该日志文件后所有功能照常**。
- **A6** 零迁移：既有 deck（含 `~/test/ppttest-2026-07-25` 这类无 `source` 字段的旧格式）
  打开工作台不报错、不被改写。
- **A7** 契约未变：`ContentSpecSchema`、`specViewFingerprintValues`、`buildPageGenerationPrompt`
  与 `SCHEMA_VERSION` 全部保持不变。
- **A8** 付费门槛：任何会发起图像生成的动作，事前都有写明调用次数与不可撤销的确认。
- **A9** 测试基线不倒退（当前 774：core 111 / desktop 474 / cli 189），新增能力有对应测试。

## 子任务地图

| 子任务 | 交付物 | 独立验收方式 | 依赖 |
|---|---|---|---|
| ① 规格编辑与变更日志底座（core/CLI） | 条目编辑写入路径、变更日志契约与读写、回滚、批量重生成命令 | CLI 层跑通「改条目 → 落盘 → 记日志 → 回滚 → 批量重生成」 | 无 |
| ② planning 视图：规格可见可编辑（桌面端） | 新 `AppView`、条目列表、逐字段编辑器、已过时页清单与勾选确认 | 全程不碰 JSON 即可完成所有编辑 | ① |
| ③ 策划对话：提问收敛与对话式改稿 | 多轮提问 provider、会话落盘、提案 diff 确认、背景材料输入 | 从一句构思经多轮问答产出规格，并用自然语言改稿落盘 | ①② |

**跨子任务契约由父任务独占**：变更日志 schema、模型提案 schema、D5 的 D7 放宽口径、
planning 会话文件布局。任一子任务发现契约需改，回父任务改，不在各自实现里微调
——M5 的教训是「来源契约由父任务独占」，否则要到最后集成才炸。

## 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 全量条目提案的 token 成本 | 长 deck 的「整份大纲改写」上下文压力大 | 作用域分单条目 / 全 deck 两档，必要时分批；单条目改稿是默认路径 |
| 五维度收敛显得机械 | 不适用的场景（如纯内部汇报无「受众」）体验差 | 允许模型把维度标「不适用」，且用户随时可跳过出稿 |
| 零页 deck 撞到既有边界 | 控制台 / `deck status` / `deck run` 可能对空 `slides` 有未覆盖分支 | R8 单列为需求，子任务① 用真实工作区验证 |
| D5 放宽未回写规范 | 后来者按 M5 D7 判定本里程碑违规 | 父任务阶段一即回写 `.trellis/spec/` 与 ROADMAP |
| 批量重生成误伤已验收产物 | 花钱且覆盖人工成果 | 默认全选但可逐页取消；确认文案写明下游失效范围；A4 验收「未勾选页字节不变」 |
| 第三方网关无 `x-request-id` | 变更日志里模型调用的 `requestId` 恒为 `null` | 已知非缺陷（换机器说明 §1），日志如实记 null，不伪造 |

## 不做

- 开放 ①引导语 / ⑤铁律 / 调用参数（D8）。
- 把 `style` 拆成结构化子字段、升 `SCHEMA_VERSION`、改任何 M5 生成侧契约（D2 / A7）。
- `.pptx` / `.docx` / 笔记的解析导入（D1，后置另评）。
- 执行侧回看依据：按 attempt 冻结的 `slides/<page>/stages/init/<attemptId>/` 快照在界面上无入口，
  ROADMAP 明确该缺口**不属于 M6**，目前无里程碑归属。
- 自动配图审美评判、模板市场、多人协同编辑规格（ROADMAP 非目标）。
