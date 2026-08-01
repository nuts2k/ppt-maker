# M5 技术设计（父任务：跨子任务契约）

本文只定**子任务之间必须共享的契约与语义**。各子任务内部实现细节在其自身 `design.md` 中展开。
父任务不写实现代码，但契约变更必须先在此定稿，四个子任务据此对齐。

## 1. 边界：来源属于 slide，不属于 deck

来源信息落在 **slide workspace manifest**，deck manifest 不冗余存储。

依据：

- slide workspace 可脱离 deck 独立存在（`slide init` 是独立命令，`apps/cli/src/index.ts:87`）。
  来源只记在 deck 层，独立 slide 就没有来源信息。
- `deck status` 已经逐页 `loadSlideWorkspace`（`apps/cli/src/deck/status.ts`），
  deck 总览读取 slide manifest 是既有做法，不需要为显示来源而冗余。
- 双写会制造一致性风险。M4 的技术结论明确点名「会话层状态盖住耐久层」「记录与事实相反」
  这类静默分歧比报错更危险。单一事实源直接消除该类缺陷。

`DeckSlideEntry.sourceImageName` 保持不动（它是 deck 编排层的显示名，不是来源维度）。

## 2. 来源契约 `SlideSource`

新增于 `packages/core/src/workspace-contracts.ts`（或独立 `source-contracts.ts`，由子任务 ① 定）。
按 `kind` 判别联合，每个分支只装该来源真正拥有的溯源信息，不做「所有字段可空」的大宽表。

```
SlideSourceKind = "imported" | "extracted" | "generated"

ImportedSource {
  kind: "imported"
  originalFileName: string          // 仅溯源用，不参与任何校验或路径解析
  recordedAt: datetime
  attemptId: string                 // 产生该来源的 init attempt
}

ExtractedSource {
  kind: "extracted"
  documentName: string
  documentSha256: sha256            // 同一 PDF 重抽可比对
  pageNumber: int >= 1              // 1-based
  hasExtractableText: boolean       // D1：矢量文本层探测结果
  rendererId: string                // 渲染器标识
  rendererVersion: string           // 版本，保证可复现
  renderDpi: int > 0
  recordedAt: datetime
  attemptId: string
}

GeneratedSource {
  kind: "generated"
  specEntryId: string               // 内容规格中该页条目 id，一经分配不得变更
  specEntrySha256: sha256           // 生成时该【条目】的指纹，不是整份规格文件的指纹
  providerId: string
  model: string
  promptVersion: string
  promptSha256: sha256              // 提示词全文另存为资产，此处只放指纹
  parameters: Record<string, unknown>
  recordedAt: datetime
  attemptId: string
}
```

**成本与用量不重复存放**：`generated` 的耗时、用量、请求 id、原始响应已经属于
`ProviderCallRecord`（`workspace-contracts.ts:109`）的职责。`GeneratedSource` 只持有
`attemptId`，通过它关联到该次 attempt 的 `provider_record` 资产。避免两处成本数据分叉。

`attemptId` 是每个分支的公共字段：它把来源锚定到具体一次 `init` attempt，
使换源历史通过既有 `attempts` 数组天然可追溯，无需另建历史结构。

## 3. 兼容策略：可选字段 + 加载期归一化，不升版本

`SlideWorkspaceManifest` 新增 `source: SlideSource | null`（**可选，缺省 null**）。

- `SCHEMA_VERSION`、`workspaceVersion`、`deckVersion` **全部不变**，无迁移程序，满足 R2 / A4。
- `loadSlideWorkspace` 在加载期归一化：`source === null` 时补一个 `imported` 分支，
  `originalFileName` 取自 `config.sourceImagePath` 的 basename，`attemptId` 取 `init` 阶段的
  `lastSuccessfulAttemptId`。
- 归一化后**内部类型为必填**，业务代码不出现 `?? "imported"` 的散落判断。
  只有磁盘 schema 是可选的。

语义正确性：M0–M4 唯一入口就是 `imported`，把历史数据视为导入不是猜测而是事实。

## 4. 换源语义

### 4.1 动作归属

作用于 slide workspace 的 `replaceSlideSource`，deck 层提供按页寻址的薄包装
（与 `add-slide` / `remove-slide` 同构）。原因同 §1：slide 可独立存在，能力不能只挂在 deck 上。

### 4.2 执行序列

1. 校验新源图（16:9 硬断言 `assertWideImage`，PNG/JPEG）。
2. 写入新的 `source_image` 资产（新资产 id，旧资产记录**保留**，不删除文件）。
3. 追加一次 `init` attempt，`inputFingerprint` 取新源图指纹；来源信息随该 attempt 写入
   `manifest.source`。
4. 更新 `sourceImageAssetId` 与 `config.sourceImagePath` 指向新资产。
5. 按 D4 处理已有 `text_review`（见 §4.3）。
6. `invalidateStageAndDownstream(states, "accept-source", reason, now)`，
   随后按**新来源**重新判定 `accept-source` 的状态（见 §4.5）。

注意第 6 步失效的起点是 `accept-source` 而非 `init`：`init` 刚刚成功完成，
把它标 `stale` 会与事实相反。`accept-source` 及其全部下游转 `stale`
即达成「换源后下游失效」。

失效**只作用于本页**。deck 层不做任何跨页联动，满足 A3 的「其它页完全不受影响」。

### 4.3 人工复核成果的处理（D4）

默认：换源后该页 `text_review` 不参与后续合并。

实现口径由子任务 ① 定，但必须满足：`review` 阶段重跑时 `readExistingReview` 拿不到旧文档
（`apps/cli/src/slide/review.ts:224`），从而 `mergeTextBlockCandidates` 的 `existing` 为 `null`
（`packages/core/src/text-blocks.ts:362`），人工块不被继承。

**不得**直接删除文件却把 `text_review` 资产记录留在 `assets` 里——那会造成资产指向不存在的文件。
两个可接受方向（子任务 ① 择一并说明理由）：连同资产记录一并移除；或按 attempt 归档并让
`readExistingReview` 只认当前 `init` attempt 之后产生的文档。

显式保留选项：CLI 开关 + 桌面端需主动勾选，走现有 IoU 对齐路径。
保留是**用户显式选择**的结果，不是默认行为，因此不构成静默分歧。

### 4.4 与既有规范的边界澄清

`.trellis/spec/backend/contracts.md:236` 已固化：「合并保留既有人工确认值，不静默覆盖」。
D4 与它**不冲突**，边界如下：

- 该条规范约束的是**同一源图下的重跑合并**——OCR 重跑、参数调整、阶段重算时，
  人工确认过的块不得被机器结果盖掉。这条继续完全有效，本任务不改动
  `mergeTextBlockCandidates` 的既有行为。
- 换源改变的是**源图本身**。旧图上的人工判断对新图不成立，继承它不是「保留成果」
  而是把过期结论冒充为当前结论。
- 「不静默覆盖」的关键词是**静默**。换源是用户主动发起的显式操作，清空是它公开、
  确定、可预期的后果，且提供显式保留开关。这与规范要防的「机器悄悄盖掉人工结果」
  是相反的两件事。

子任务 ① 在 Phase 3 更新 spec 时，须把这条边界写入 `contracts.md`，
避免后续实现者从规范单条文字得出相反结论。

## 4.5 源图确认闸门 `accept-source`（D6）

`generated` 页不得自动接入下游链路：批量生成后每张图必须经人工确认才继续走 `ocr`。
`imported` 与 `extracted` 视作已确认，不停顿。

### 为什么这不违背「来源是维度而非新链路」

`ArtifactAcceptance`（`contracts.md:241`）已经是**通用验收契约**，`accept-clean` / `accept-pptx`
是它的两个实例，都带 `artifactSha256` 与 `upstreamFingerprint` 哈希锚定（`contracts.md:257`）。
源图确认是第三个**同构实例**，不是新机制。

更关键的是：**阶段图对三种来源完全相同**。差别只在 `accept-source` 的初始状态——
`generated` 为 `pending`，其余为 `completed`。来源决定的是「源图是否已被信任」这一个布尔量，
不是「走哪条链路」。抽象仍然成立。

### 阶段图变更

```
init → accept-source → ocr → review → assist-review → mask → clean
     → accept-clean → pptx → accept-pptx → report
```

`STAGE_DEPENDENCIES`（`packages/core/src/stage-graph.ts:12`）：
新增 `"accept-source": ["init"]`，并把 `ocr` 的依赖由 `["init"]` 改为 `["accept-source"]`。
这是本任务对阶段图的**唯一**改动。

### 自动放行必须与人工确认在磁盘上可区分

`imported` / `extracted` 的 `accept-source` 置为 `completed`，但**不写** `accepted.json`——
`ArtifactAcceptance` 只在真有人确认时产生。自动放行的事实记录在该阶段 attempt 上
（`provider` 用一个明确标识如 `auto-source-trust`，`WorkspaceStageAttempt` 已有该字段）。

理由是 M4 的核心教训：写一条 `acceptedBy` 指向系统的验收记录，等于让报告声称
「这页源图有人确认过」，而事实是没有。这正是 M4 列为头号风险的那类「记录与事实相反」。
状态可以是 completed，但**不能伪造人工痕迹**。

`ArtifactAcceptance.stage` 枚举仍需追加 `accept-source`，供 `generated` 页的真实人工确认使用。

### 换源后的重新判定

§4.2 执行序列的第 6 步随之修正：失效起点由 `ocr` 改为 `accept-source`，
且该阶段的新状态**按新来源重新判定**——换成生成图要重新确认，换成导入图自动放行。

这正是「换源与新图来自哪种来源无关」这条通用性的体现：换源统一走一条路径，
而这条路径按新来源决定是否需要重新确认，不需要为「重新生成」单开分支。

注意此时该页尚无下游产物（换源已使其全部 `stale`），
所以 D4 的默认清空在此处无额外代价。

### 对批量执行的影响

M4 已有「一键处理全部逐页串行 + 需人工介入的页自动归入待办队列」。`generated` 页在
`accept-source` 处停下会自动进入该队列，**无需新造机制**。批量确认的界面形态属于子任务 ④。

### 人工点数量的口径变更

M4 固化的「链路收敛为双人工点」（`contracts.md:365` 场景节）需更新为：
**最多三个人工点，其中源图确认按来源条件性激活**。`imported` / `extracted` 仍是两个，
`generated` 是三个。子任务 ① 在 Phase 3 更新 spec 时一并修正，
并同步 `apps/desktop/src/shared/gates.ts` 的闸门文案单点定义（`contracts.md:410`）。

## 5. 闭合枚举的扩展

三处闭合枚举需要扩展，全部为**追加**，不改动既有值，既有数据继续有效：

| 枚举 | 位置 | 扩展 | 需求方 |
|---|---|---|---|
| `SlideStage` | `workspace-contracts.ts:6` | `accept-source`（见 §4.5） | ① |
| `ArtifactAcceptance.stage` | `workspace-contracts.ts:144` | `accept-source` | ① |
| `WorkspaceAsset.role` | `workspace-contracts.ts:39` | `source_acceptance`（源图人工确认记录，随 §4.5 一并落地）、`source_document`（PDF 原件或其引用）、`content_spec`（生成时的规格快照）、`generation_prompt`（提示词全文） | ①（`source_acceptance`）、②③（其余） |
| `ProviderCallRecord.stage` | `workspace-contracts.ts:111` | `init`（生成发生在 init 阶段） | ③ |
| `ProviderCallRecord.provider` | `workspace-contracts.ts:112` | 由 `z.literal("openai")` 放宽为具名枚举，保留 `openai` 为其一 | ③ |

### `SlideStage` 扩展的边界

`accept-source` 是本任务对阶段图的**唯一**改动，且它是**验收闸门**而非处理阶段——
`ArtifactAcceptance` 契约的第三个同构实例，不引入任何新的处理语义。

除它以外 `SlideStage` 不再扩展：三种来源都在 `init` 阶段产出源图，走完全相同的下游链路。
若某个子任务发现还需要加**处理阶段**（而非验收闸门），说明来源抽象没有成立，
应回到父任务重新决策，不得自行扩展。

`accept-source` 的加入使既有工作区多出一个阶段状态。`SlideWorkspaceManifestSchema` 的
`superRefine` 会校验「所有 `SlideStage` 都必须有对应状态」（`workspace-contracts.ts:249`），
因此**旧 manifest 会校验失败**。这是 §3 零迁移策略的唯一例外点，加载期归一化必须一并
补齐该状态：旧数据一律视为 `imported`，故 `accept-source` 补为 `completed`，
其 `latestAttemptId` / `lastSuccessfulAttemptId` 沿用 `init` 阶段的值。
子任务 ① 必须有针对旧 manifest（无 `source`、无 `accept-source` 状态）的加载回归测试。

## 6. 内容规格：跨里程碑契约

内容规格是 deck 级文件（deck 工作区内，非 slide 内），是 M5 的 `generated` 与
后续内容策划里程碑之间的**唯一接口**：

- 生成侧只消费规格，不关心规格从哪来（手写、一次性模型初稿、或未来的交互式策划）。
- 策划侧只产出规格，不关心图怎么生成。

因此规格的形状由子任务 ③ 定稿后即冻结为契约，策划里程碑接上时生成侧不应改动。
规格至少要能表达：deck 级视觉风格约定、逐页的文字内容与视觉意图。

**规格文字 → `reference_text` 的落地**：生成某页时，把该页规格条目中的文字写入该页
`reference_text` 资产，并让 `config.referenceTextPath` 指向它。既有链路
（`attachReferenceCandidates`）会自动把它作为识别参考。这符合 ROADMAP §2
「原始文案仅作识别参考，图片中实际可见的独立版式文字才是恢复对象」——
规格文字不直接成为文本层，只提高 OCR 结果的可信判定。

### 6.1 规格是双层的：deck 级意图 + slide 级快照（D7）

重新生成通常伴随规格调整，因此规格必然是**可变**的。可变的规格与不可变的产物之间
必须有清晰边界，否则无法回答「这张图是按哪一版规格生成的」。

| 层 | 位置 | 可变性 | 角色 |
|---|---|---|---|
| deck 级内容规格 | deck 工作区 `content-spec.json` | **可编辑** | 当前意图。策划里程碑的产物，生成侧的输入 |
| slide 级规格快照 | slide 工作区 `content_spec` 资产（§5 已列该 role） | **不可变**，随 attempt | 该页某次生成实际使用的条目，永久留存 |

每次生成把**该页规格条目的快照**写入 slide 工作区。deck 级文件后来怎么改，
都不影响已生成页的可追溯性——历史天然由 attempt 的资产序列保存，无需另建版本机制。

**`specEntryId` 一经分配不得变更**。增删页不得影响其它条目的 id，否则关联断裂。

### 6.2 规格漂移是派生判断，不是阶段状态

改了某页规格但还没重新生成时，图与规格不一致。这个事实必须可见——否则界面显示
「已确认」而当前意图早已变了，正是 M4 点名的静默分歧。

处理方式：比较 `GeneratedSource.specEntrySha256` 与 deck 级规格中该条目的当前指纹，
不一致即为**规格漂移**，在 `deck status` 与桌面端总览如实标注
「当前图基于旧版规格」。

它是**只读的派生标志，不改变任何阶段状态**：

- 不自动转 `stale`。规格改动可能只是错别字，或用户在批量编辑规格，
  不应静默推翻已确认的产物。
- 已跑到 `accept-pptx` 的页同样只标注不失效——产物基于那张图，图并没有变，
  验收依然有效。
- sha 比较天然处理「改了又改回来」：改回原样即不再漂移，无需状态复位逻辑。

事实被如实呈现，是否重新生成由用户决定。这既避免静默分歧，也避免自动失效带来的意外损失。

### 6.3 最小调整闭环

M5 不做规格编辑器（那是策划里程碑），但必须有可用的调整手段。两条并存：

1. **重生成时附带一句调整说明**（自然语言，如「标题再大一点，配色改深蓝」）。
   这是主路径——生成图不满意时的即时反馈，不需要用户手写完整规格，
   符合 D3「尽量减少手写」的意图。
2. 规格文件本身可直接编辑（它就是个文件），供批量调整使用。

**调整说明必须回写规格条目**，建议形态为条目下的 `revisionNotes: string[]` 逐次追加，
生成提示词 = 基础视觉意图 + 全部 revision notes。理由：

- 说明若只作用于单次调用而不回写，规格与产物就会脱节——规格声称的意图不是图实际的意图，
  且 §6.2 的漂移检测会失效（规格没变但图变了）。
- 机械追加，**不引入模型改写规格**。让模型重述用户意图属于策划里程碑的范畴，
  在这里只会制造不可控的语义漂移。

具体形状由子任务 ③ 定稿，定稿即冻结为跨里程碑契约。

## 7. PDF 抽取的两条产品判断落地

- **D1 探测结果**落在 `ExtractedSource.hasExtractableText`，并须在桌面端逐页可见（子任务 ④）。
  处理方式本身是**确定单一**的（一律位图化），探测只提供可见性与未来直取路径的判断依据，
  不构成 ROADMAP 所禁止的「混在同一条路径里含糊处理」。
- **D2 逐页判定**：抽取命令对每页独立判定 16:9，产出 `{建立的页, 跳过的页 + 尺寸 + 原因}` 报告，
  进程退出码在「有页被跳过但至少建立了一页」时**不视为失败**。整份为空才失败。

## 8. 不做与理由

- 不为 `extracted` 放宽 `aspectRatio`：会波及 clean plate 尺寸档位（2048×1152）、
  PPTX 页面尺寸常量（`PPTX_WIDE_WIDTH_INCHES` / `PPTX_WIDE_HEIGHT_INCHES`）与导出校验，
  且同 deck 混合宽高比会让导出语义变复杂。收益不抵成本。
- 不新增 slide 阶段：见 §5。
- 不做 schema 版本升级与迁移程序：见 §3。
