# M5 页面来源与内容策划（父任务）

## 目标

在稳定的转换引擎（M0–M4）之上接入上游，把「这一页的图从哪来」抽象为独立维度，
让 `imported` / `extracted` / `generated` 三种来源进入同一条转换链路，并可在同一个 deck 内混合。

来源：ROADMAP §4 M5。本任务是**父任务**，只拥有跨子任务契约、任务地图与最终集成验收，
不承担直接实现；实现全部在四个子任务中完成。

## 背景与现状（代码事实）

| 事实 | 位置 |
|---|---|
| `DeckSlideEntry` 只有 `sourceImageName`，无来源维度与溯源信息 | `packages/core/src/deck-contracts.ts:8` |
| deck 层只有 `add-slide` / `remove-slide`，没有「替换某页源图」 | `apps/cli/src/deck/add-slide.ts`、`remove-slide.ts` |
| 阶段失效链路已完备：`invalidateStageAndDownstream` + `completedInputFingerprint` | `packages/core/src/stage-graph.ts:70`、`apps/cli/src/slide/invalidate.ts:26` |
| 重跑 review 会保留人工编辑块并按 IoU 与新 OCR 结果对齐 | `packages/core/src/text-blocks.ts:362` |
| 16:9 为硬断言，不自动裁剪拉伸补边，容差 0.005 | `packages/core/src/geometry.ts:74`、`constants.ts:4` |
| deck 与 slide 两层都锁 `aspectRatio: z.literal("16:9")` | `deck-contracts.ts:35`、`workspace-contracts.ts:182` |
| `ProviderCallRecord.stage` 仅枚举 `assist-review \| clean`，`provider` 仅 `openai` | `workspace-contracts.ts:109` |
| 已有 OpenAI 图像**编辑**封装（`images.edit`，gpt-image-2，2048x1152） | `apps/cli/src/providers/openai-image.ts` |
| 资产 `role` 为闭合枚举，新增来源产物需扩枚举 | `workspace-contracts.ts:39` |
| `SlideStage` 为闭合枚举，`init` 为链路起点且无上游依赖 | `workspace-contracts.ts:6`、`stage-graph.ts:12` |
| slide workspace 可脱离 deck 独立存在（`slide init` 是独立命令） | `apps/cli/src/index.ts:87` |
| `deck status` 已逐页 `loadSlideWorkspace`，deck 总览读 slide manifest 是既有做法 | `apps/cli/src/deck/status.ts` |
| `SCHEMA_VERSION = 1`，`deckVersion = 1`，`workspaceVersion = 1` | `packages/core/src/constants.ts:1` |

**关键推论**：换源不需要新造失效机制，只需把「替换源图资产」接到既有的阶段失效级联上；
源图确认闸门也不是新机制，`ArtifactAcceptance` 已是通用验收契约，`accept-clean` /
`accept-pptx` 只是它的两个实例。真正缺的是来源契约字段、deck/slide 层的换源动作、
第三个验收闸门实例，以及两个新入口。

## 已定决策

| ID | 决策 | 结论 | 影响 |
|---|---|---|---|
| D1 | 矢量 PDF 处理 | **一律位图化，但 init 时探测并记录每页是否含可提取文本层，界面显式提示**。直取文本路径不在 M5 | `extracted` 只有一条路径；探测结果进入溯源信息 |
| D2 | 16:9 对 `extracted` 是否放宽 | **维持拒绝，尺寸假设全链路不动**；抽取改为逐页判定，不合格页带尺寸与原因进入报告并跳过，不让单页异常挂掉整份导入 | 无契约变更，只增抽取阶段的按页报告 |
| D3 | 内容策划深度 | **策划独立成新里程碑**，M5 只做生成执行侧（规格 → 图 → slide），并提供一次性「构思/大纲 → 规格初稿」动作避免全手写。两者以**内容规格文件**为契约衔接 | ROADMAP 需新立 M6「内容策划工作台」，现 M6 顺延为 M7 |
| D4 | 换源后已有人工复核成果 | **默认清空该页 text_review，整页从 init 重来**；提供显式保留选项（CLI 开关 / 桌面端需勾选）供「同提示词微调重生成」场景 | 默认不制造「已确认但属于旧图」的静默分歧 |
| D5 | 子任务切分 | **基座纵切 + 入口收口**：①契约与换源（含桌面端换源 UI）②PDF 抽取 CLI ③图片生成 CLI ④桌面端新建来源入口收口 | ②③ 可并行；界面统一设计，不重蹈 M4 覆辙 |
| D6 | 生成图是否自动进入下游 | **不自动**。`generated` 页批量生成后每张必须经人工确认才走 `ocr`（重新生成概率高）；`imported` / `extracted` 视作已确认，不停顿 | 新增验收闸门 `accept-source`，是 `ArtifactAcceptance` 的第三个同构实例；人工点从「双」变为「最多三，按来源条件性激活」 |
| D7 | 逐页规格调整 | 规格**双层**：deck 级可编辑意图 + slide 级不可变快照。规格改动只产生**只读漂移标注**，不自动失效任何阶段。调整主路径是「重生成时附带一句说明」并**回写**规格条目，不引入模型改写 | 溯源指纹必须是**条目级**而非整份文件级，否则改一页会污染全 deck 的一致性判断 |

## 需求

- **R1 页面来源契约**：按页记录来源类型（`imported` / `extracted` / `generated`）与其溯源信息。
  溯源信息按来源分支：导入自哪个文件；抽取自哪个文档的第几页、该页是否含可提取文本、渲染器版本；
  生成用的规格条目与其条目级指纹、提示词版本与指纹、模型与参数。
  用量成本**不重复存放**于来源契约，由 `ProviderCallRecord` 持有，经 `attemptId` 关联
  （见 `design.md` §2）。
- **R2 向后兼容**：M3/M4 时代产出的 deck 与 slide 工作区无需迁移即可打开、继续处理并严格导出。
- **R3 换源操作**：新增「替换某页源图」的能力，接入既有指纹失效链路，CLI 与桌面端各有入口。
  换源与新图来自哪种来源无关——重新生成、换个文件、从 PDF 重抽走同一条路径。
- **R4 PDF 抽取**：文档逐页转位图并建立 slide workspace，按 D1 探测记录、按 D2 逐页判定。
- **R5 图片生成**：内容规格驱动逐页生成，Provider 抽象、提示词与模型版本、成本记录齐备；
  规格中该页的文字自动落为该页 `reference_text`，喂给既有 review 链路。
- **R6 混合来源**：同一 deck 内三种来源可任意混合，deck 总览可看出每页来源。
- **R7 路线图对齐**：ROADMAP 新立内容策划里程碑，M5 完成条件与本任务实际范围一致。
- **R8 源图确认闸门**：`generated` 页在进入 `ocr` 前必须经人工确认；批量生成后逐张确认，
  不满意即重新生成（走换源路径）。`imported` / `extracted` 自动放行且不伪造人工验收记录。
  换源后按新来源重新判定是否需要确认。
- **R9 逐页规格调整闭环**：重新生成某页时可附带一句自然语言调整说明，说明回写该页规格条目；
  每次生成留存该页规格条目快照，可追溯「这张图按哪一版规格生成」；
  规格条目改动后与当前图不一致时，`deck status` 与桌面端总览如实标注规格漂移，
  但不自动失效任何阶段。

## 验收标准（跨子任务，父任务负责最终集成审查）

> **A1–A13 已于 2026-08-02 全部真机走查通过**，逐条证据见 `walkthrough/`（`README.md` 是索引）。
> 走查暴露 8 条缺陷，分两批修完（提交 `25d6d4e`、`303ea43`），测试 732 → 774。
> 其中 A2 的 CLI 人读输出、A10 的报告区分、A11 的正向换源三条是**修复后复验通过**的，
> 不是走查当场就成立。代劳的人工步骤（复核质量判断、PowerPoint 人工检查、原生对话框）
> 已在 `README.md`〈代劳处〉逐条登记。

- [x] A1 三种来源均可建立 deck 并跑通到可编辑 PPTX。
- [x] A2 单个 deck 内混合三种来源（例：1/3 页导入、2 页 PDF 抽取、4–6 页生成），
      `deck status` 与桌面端总览能逐页看出来源，`deck export --strict` 通过。
- [x] A3 任一页换源后：该页 `accept-source` 及下游全部转 `stale`（`init` 保持 `completed`），
      该页 `text_review` 默认已清空，**其它页的阶段状态与已确认产物完全不受影响**；
      显式保留选项能保住人工块。
- [x] A4 M3/M4 时代产出的既有 deck 直接打开、继续处理并 `--strict` 导出成功，无迁移步骤。
- [x] A5 含矢量文本层的 PDF 抽取后，每页的可提取文本探测结果落盘且在界面可见。
- [x] A6 混合宽高比的 PDF 抽取后，16:9 页正常建立、非 16:9 页带尺寸与原因进入报告并跳过，命令不整体失败。
- [x] A7 `generated` 页的提示词、模型版本、参数与用量成本可从工作区完整追溯到具体 attempt。
- [x] A8 ROADMAP 的 M5 与后续里程碑描述与实际交付一致。
- [x] A9 批量生成 N 页后执行「一键处理全部」，全部 `generated` 页停在源图确认、进入待办队列，
      无一页自行跑到 `ocr`；同 deck 内的 `imported` / `extracted` 页不因此停顿，照常推进。
- [x] A10 自动放行不伪造人工痕迹：`imported` / `extracted` 页的 `accept-source` 为 `completed`
      但磁盘上没有 `accepted.json`，报告能区分「人工确认」与「按来源自动放行」。
- [x] A11 把一页从 `imported` 换源为 `generated` 后，该页重新回到待确认；
      反向换源则自动放行。
- [x] A12 带调整说明重新生成某页后：说明已回写该页规格条目，新图基于含该说明的提示词，
      且该页留有两次生成各自的规格条目快照，可分别追溯。
- [x] A13 **规格漂移不污染其它页**：编辑第 4 页规格条目后，只有第 4 页标注漂移，
      其余 `generated` 页无任何变化；所有页的阶段状态均不改变。
      把第 4 页规格改回原样后，漂移标注消失。

## 子任务地图

| # | 子任务 | 范围 | 依赖 |
|---|---|---|---|
| ① | 页面来源契约与换源操作 | 来源契约、兼容归一化（含 `accept-source` 状态补齐）、`accept-source` 闸门与阶段图变更、`replace-source`（slide 层动作 + deck 层按页寻址）、失效接入、CLI 入口、桌面端换源 UI | 无 |
| ② | PDF 抽取（`extracted`） | 逐页渲染、矢量文本探测、按页 16:9 判定与部分导入报告、CLI 入口 | ① |
| ③ | 图片生成（`generated`） | 内容规格双层契约、Provider 抽象与 16:9 能力实证、提示词/模型/成本记录、规格文字落 `reference_text`、规格初稿一次性生成、带调整说明重生成与规格回写、规格漂移检测、CLI 入口 | ① |
| ④ | 桌面端新建来源入口收口 | 「新建 deck 时选来源」的统一界面、②③ 的桌面端入口、总览的来源列与规格漂移标注、**批量源图确认界面**（逐张接受 / 带一句说明重新生成） | ②③ |

②③ 可并行。ROADMAP 更新（R7）由父任务直接完成，不单开子任务。

## 风险

- **RK1 生成图能否直接产出 16:9**：现有 `images.edit` 用 `2048x1152` 走的是 SDK 的
  `(string & {})` 自由 size 通道（`openai-image.ts:52` 注释已说明无字面量校验），
  `images.generate` 是否接受同一尺寸**未经验证**。若 Provider 只能出 3:2 / 1:1 等档位，
  `generated` 会直接撞上 16:9 硬约束，需要另立产品决策（裁剪自产图 vs 换 Provider）。
  → 子任务 ③ 的第一步必须是实调验证，验证失败则回到父任务重新决策，不得在实现中默认。
- **RK2 生成图的跨页风格一致性**：同 deck 多页独立生成大概率风格不统一，做出来的 PPT 不可用。
  归属子任务 ③ 的设计范围（风格描述统一段 / 首页作风格参考图 / 两者兼有），
  在 ③ 的 brainstorm 中定论。
- **RK3 枚举扩展的波及面**：`WorkspaceAsset.role`、`ProviderCallRecord.stage` 与 `provider`
  均为闭合枚举，扩展会波及既有校验与消费点。归一化与扩展策略见 `design.md`。
- **RK4 `accept-source` 打破零迁移**：新增阶段会让旧 manifest 撞上
  「所有 `SlideStage` 都必须有对应状态」的校验（`workspace-contracts.ts:249`），
  旧工作区**会直接加载失败**。这是 A4 的最大威胁，也是 `design.md` §3 零迁移策略的唯一例外点。
  防线是加载期归一化一并补齐该状态 + 子任务 ① 必须有旧 manifest 加载回归测试。
  → 若归一化方案在子任务 ① 被证明不可行，须回父任务重新考虑 `accept-source` 的落地形式。

## 不做

- 交互式内容策划（构思/背景/文件 → 对话 → 逐页内容）：新里程碑承接，见 D3。
- 矢量 PDF 直取文本路径：见 D1。
- 放宽 16:9、裁剪或补边输入：见 D2。
- 通用 Agent CLI、MCP、插件市场、多种设计产物平台（ROADMAP M5 非目标）。
- 账号、云同步、多人协作。
