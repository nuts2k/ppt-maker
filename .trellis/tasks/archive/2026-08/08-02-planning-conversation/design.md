# 策划对话技术设计

## 1. 边界与不变量

本任务在父任务四条跨子任务契约之内实现，不改以下既有口径：

- `ContentSpecSchema`、`specViewFingerprintValues`、`buildPageGenerationPrompt`、
  `SCHEMA_VERSION` 保持不变。
- 模型只能产生提案；确认前不得写 `content-spec.json`，确认后必须调用
  `applySpecChange`，并写 `origin: "proposal"` 与 `conversationRef`。
- 规格变化只更新漂移判断，不自动失效任何流水线阶段。
- `planning/` 全部是旁路数据；删除后只失去会话、材料和历史，生成主链路照常。
- 策划提问与改稿提案是两个模型面、两套 schema；都使用 Responses API、
  `zodTextFormat`、`store: false`，外部响应先 `safeParse`。

现有 `PlanningPage` 的左右骨架不重做：左栏在「对话 / 历史」之间切换，右栏继续承载规格编辑；
出现待确认提案时，右栏暂时切换为逐字段 diff，决策完成后回到编辑器。

## 2. core 契约

### 2.1 五维度状态

五个维度固定为 `audience`、`scenario`、`length`、`structure`、`style`；每项状态为：

- `open`：信息仍不足；
- `resolved`：已从用户输入或材料收敛；
- `not_applicable`：模型判断本场景不适用。

策划提问模型输出 `reply`、完整五维度状态、`nextQuestion` 与 `canDraft`。模型面 schema
不带 `minLength` / `refine`；落入会话前再用带约束的持久化 schema 校验。

### 2.2 改稿提案

`SpecProposalSchema` 忠实实现父任务 design §4.3：`reply`、可空的 `styleProposal`、完整条目
提案数组。现有条目的 `specEntryId` 只作为定位提示：代码只接受当前规格中确实存在的 id；
新增条目必须由代码分配 id；未知非空 id 视为无效 provider 响应，不能原样写盘。

初稿继续复用 `ContentSpecDraftSchema`，代码把它转换成完整候选规格并分配
`specId`、`specEntryId` 与时间戳。分配发生在提案进入会话之前，因此重开工作台后看到和接受的
仍是同一份候选规格，不会临时再生成一组 id。

### 2.3 会话记录是追加式联合类型

父任务 design §5 使用：

```ts
type PlanningSessionRecord = PlanningMessage | PlanningProposalDecision;
```

`PlanningMessage` 保存文本、模型追踪字段、可空五维度状态与可空提案。提案字段保存一个带类型的
信封，至少含：

```ts
interface StoredPlanningProposal {
  readonly kind: "initial-draft" | "spec-change";
  readonly raw: unknown;              // 模型结构化输出原样留痕
  readonly candidate: ContentSpec;    // 代码归一化后的完整候选规格
  readonly scope: "initial" | "entry" | "deck";
}
```

`PlanningProposalDecision` 只追加接受 / 拒绝结果并指向提案消息。读取时折叠记录得到：消息列表、
最新五维度状态、每份提案的状态和唯一待确认提案。坏行跳过；同一提案若出现多个决策记录，以
第一条有效记录为准并忽略后来行，避免损坏数据反复翻转已完成决策。

E5 在领域层执行：存在待确认提案时，新的提问、出初稿和改稿请求均拒绝。不能只靠按钮禁用，
否则重开、测试或未来调用方可绕过界面制造多份并发提案。

### 2.4 跨层结果

core 定义 renderer / main / CLI 共用的请求结果：会话快照、提问结果、提案预览、材料条目、
提案选择与接受结果。所有跨进程数据过 Zod；`requestId` 缺失时保持 `null`。

## 3. deck 内存储

### 3.1 布局

```text
<deck>/planning/
  session.jsonl
  spec-history.jsonl
  materials/
    <导入文件副本>.md|.txt
```

扩展 `apps/cli/src/deck/planning-store.ts`，复用现有按 deck 分键的串行尾队列：

- `appendPlanningSessionRecords` 一次追加一轮所需的多行，避免“用户消息写成、assistant 消息没写成”
  的半轮状态；
- `listPlanningSessionRecords` 缺文件返回空、坏行跳过，读取绝不创建目录；
- `listPlanningMaterials` 只列 `.md` / `.txt`，按文件名稳定排序；
- `importPlanningMaterial` 复制到 deck 内，重名时生成不覆盖的后缀名；
- `removePlanningMaterial` 只接收已列出的文件名并校验路径仍在 `materials/` 内。

会话是本功能的必要过程证据：模型返回提案后，必须先成功追加消息再把提案交给界面；写失败时
本轮报错且不产生可接受的提案。规格历史仍保持既有旁路纪律，不因历史写失败回滚规格。

### 3.2 材料上下文

E3 规定全部材料是 deck 级长期背景。每次模型调用都重新读取当前材料列表并以“文件名 + 正文”
拼入请求，确保移除立即生效、重开行为一致。任一材料读取失败须指名文件并阻止本轮调用，不能
静默少喂一份材料。删除的是 deck 内副本，不影响用户原文件。

本轮不引入材料清单数据库、启用开关或二进制解析；`.pptx` / `.docx` 在文件选择与 main 边界
都拒绝。

## 4. Provider 与领域服务

### 4.1 Provider

新增独立 provider 模块，仍复用 `openai-spec-draft.ts` 的 client / parser 注入形状，但不把三种
输出硬塞进一个 schema：

1. `askPlanningQuestion`：上下文为历史消息 + 材料；输出策划回应与五维度状态。
2. `draftPlanningSpec`：上下文同上；输出 `ContentSpecDraftSchema`，用于“就按现有信息出初稿”。
3. `proposeSpecChange`：上下文为用户指令 + 当前规格 + 材料；输出 `SpecProposalSchema`。

E4 的全 deck 改写只发一次请求，超出 provider 限制则整轮失败；不自动串行拆分。单条目作用域
只把目标条目作为可改对象；deck 风格与必要的相邻标题只作为只读上下文。模型不得在单条目
作用域修改 style 或其他条目——style 是 deck 级字段，若允许会让“改这一页”实际波及所有页。

### 4.2 策划服务

新增 deck 级服务协调 provider、会话存储、规格预览与唯一写入入口。main IPC 只做参数收窄、
运行互斥与错误翻译，不复制业务规则。

#### 多轮提问

1. 读取并折叠会话；若有待确认提案则拒绝。
2. 读取全部材料，把当前用户文本作为本轮输入调用 provider。
3. 成功后一次追加 user + assistant 两条消息；失败则两条都不追加，输入保留给界面重试。
4. 返回新的会话快照。维度进度只取最新 assistant 消息的持久化值。

加载会话时还要把 `spec-history.jsonl` 作为已接受状态的恢复证据：若会话中仍有 pending 提案，
但规格历史已存在 `origin="proposal"` 且 `conversationRef` 指向该提案消息的记录，则只在内存投影
中将它恢复为 accepted，并以历史 `recordId` 作为 `acceptedAs`。读取路径不得为了恢复而回写
`session.jsonl`；若规格历史与 accepted 决策同时缺失，则没有可校验的接受证据，继续保留 pending，
不得仅凭当前规格恰好等于候选规格猜测用户已经确认。

#### 生成初稿

仅在当前没有权威规格时开放。调用 provider 后把草稿归一化为候选 `ContentSpec`，运行
`previewSpecChange`，将 raw + candidate 作为 assistant 提案消息追加，再返回只读完整提案。
E2 规定初稿不可局部接受或先进入手工编辑态。

#### 生成改稿提案

仅在已有权威规格时开放。单条目为默认作用域；全 deck 为一次原子调用。模型输出先转成完整
候选规格并经 `ContentSpecSchema.parse`，再运行 `previewSpecChange`。此时只写会话，不写规格。

#### 接受 / 拒绝

- 拒绝：追加 `PlanningProposalDecision(outcome="rejected")`，规格字节保持不变。
- 接受：根据界面选择从已存候选规格组装最终规格，重新运行 `previewSpecChange`；用户确认文案
  使用这次结果的确切 `willDrift` / `willMiss` 数量。确认后调用 `applySpecChange`，传
  `origin: "proposal"`、`conversationRef: proposalMessageId`，最后追加 accepted 决策记录。
- 初稿必须全量接受；全 deck 改稿允许取消 style 或个别条目，符合父任务 contracts 的 Good case；
  单条目提案只允许接受 / 拒绝整条。

若规格已经写成但 accepted 决策追加失败，返回“规格已保存、会话决策未写成”的显式警告；
不得谎报整体失败并诱导用户重复接受。`ApplySpecChangeResult.record` 仍提供真实 recordId。

## 5. IPC 与状态归属

### 5.1 IPC

在 `IpcApi` 增加 `planning` 命名空间，而不是继续向 `deck` 塞互不相关的细节方法。至少包含：

- `load(deckPath)`；
- `sendMessage(deckPath, text)`；
- `draftSpec(deckPath)`；
- `proposeChange(deckPath, text, scope)`；
- `previewProposal(deckPath, proposalMessageId, selection)`；
- `acceptProposal(...)` / `rejectProposal(...)`；
- `listMaterials` / `importMaterial` / `removeMaterial`。

所有会写规格或改变提案状态的 handler 与现有手工保存共用流水线 / 建页任务互斥判据。
renderer 不直接 import `node:` 或 `@cli/*`。

### 5.2 renderer store

新增独立 `planning-conversation-store.ts`，耐久会话与现有手工规格草稿分开，避免一个 store 同时
拥有两套保存语义。状态至少含 deck 身份、消息、维度、材料、待确认提案、请求中状态与错误。

每个异步 action 在落地前比较 `deckPath`；`reset(nextDeckPath)` 按身份作废旧请求，不能用全局
序号误伤已经属于新 deck 的加载。E1 的 dirty 守卫由页面组合两个 store 后执行；main 仍负责
E5、规格存在性与写入互斥等可跨调用方保证的边界。

## 6. 界面

- 左栏顶部使用「对话 / 历史」分段控件；语义和键盘行为完整兑现，视觉复用既有按钮变体。
- 对话默认打开。无规格时显示五维度进度和“就按现有信息出初稿”；有规格时 composer 上方显示
  单条目 / 全 deck 作用域，单条目默认绑定右侧当前条目。
- 材料是紧凑列表：导入 `.md` / `.txt`、显示文件名、移除副本。空态不占固定大块版面。
- 待确认提案出现后禁用 composer，右栏显示逐字段 before / after；差异使用 `proof`，未变化字段
  保持中性。初稿只有整体接受 / 拒绝；全 deck 改稿可取消 style 或条目。
- 接受前原生确认框写明“确认后 N 页变为已过时、M 页失联”；该动作本身不生成图，不写“付费”。
  后续批量重生成继续使用现有写明调用次数与不可撤销的付费确认。
- 整屏只保留一个 primary：待确认时给“接受提案”，平时给右侧“保存规格”或对话发送动作，
  不同时出现多个主行动。
- 所有新增可交互控件满足 DESIGN.md 六态、焦点环、tabular-nums 与 reduced-motion 约束。

## 7. 兼容性、失败与回滚

- 没有 `planning/`、没有 `session.jsonl`、没有材料时均返回空状态且零写盘；旧 deck 无迁移。
- session 坏行跳过，材料读错与 provider 响应错误显式报错；不得把自由文本当结构化结果。
- 提案生成失败或拒绝时 `content-spec.json` 字节不变；接受前 preview 也不得创建或修改文件。
- 全 deck 调用若在真实 20–50 页规格上频繁超限，回滚点是隐藏全 deck 作用域，只保留单条目；
  不在同一版本加入串行分片协议。
- 删除本任务新增的 IPC、provider、conversation store 与会话存储函数即可回退；既有手工编辑、
  历史回滚与批量重生成路径不依赖它们。

## 8. 验证形状

自动验证以“领域服务 + 受控 provider 注入 + 真实临时 deck”为主，不依赖 DOM 测试库：

- 会话折叠、维度重建、唯一 pending、提案选择与确认文案测纯函数；
- provider request 断言 `store:false`、两套 schema、不含模型面不支持约束；
- session / materials 测缺失、坏行、重名、删除、读取失败与 deck 隔离；
- 集成测初稿接受、拒绝零写盘、单条目 / 全 deck 提案、conversationRef、漂移预告与重开恢复；
- 异步 store 测切 deck 迟到响应并做变异验证；
- 真机模型与图像生成只在用户明确确认调用次数和不可撤销后执行，基线 deck 一律先复制。
