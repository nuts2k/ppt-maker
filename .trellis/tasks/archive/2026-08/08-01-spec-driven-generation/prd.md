# 子任务③ 图片生成（`generated` 来源）

父任务：`07-31-page-sources-and-content-generation`（M5）。
交付 `generated` 来源的完整链路，并**定稿内容规格形状**——
它是 M5 生成侧与 M6 策划侧之间的唯一接口，定稿即冻结为跨里程碑契约。

## 目标

内容规格驱动逐页生成 16:9 页面图，建立 slide 工作区并接入既有转换链路，
使 `generated` 页与 `imported` / `extracted` 页在同一 deck 内平等共存。

## 背景：已确认事实

### RK1 已实证通过（2026-08-01）

`images.generate` 可直出 16:9：请求 `2048x1152` 实得 **1672×941**，比例误差 0.056%，
在 `assertWideImage` 的 0.5% 容差内（`geometry.ts:74`、`constants.ts:4`）。
父任务最大回滚点解除。证据与判读见 `research/rk1/CONCLUSION.md`。

**两条衍生约束**：

1. **尺寸必须落盘后实测**。网关不保证返回请求尺寸，高度在 940/941 间浮动过。
   `createSlideWorkspace` 已用 sharp 实测填 `image.width/height`（`slide/workspace.ts:264`），
   本任务沿用，**不得用请求参数填充**。反例：`clean/run.ts:329`（manifest 记 2048×1152、
   磁盘实为 1672×941，07-22 记为遗留缺陷至今未修）。
2. 实证走的是 `.env` 的第三方网关，换官方端点或换 Provider 须重验。

### ① 已铺好的地基（直接复用，不重造）

| 能力 | 位置 | 对③ 的意义 |
|---|---|---|
| `GeneratedSource` 契约已完整落地 | `source-contracts.ts:45` | 字段已冻结，③ 只负责填充 |
| `createSlideWorkspace` 接受 `options.source` 与 `options.referencePath` | `slide/workspace.ts:225` | 生成后建页一次调用完成，含规格文字落 `reference_text` |
| `replaceSlideSource` 接受 `options.source` | `slide/replace-source.ts:188` | **重生成 = 换源**，失效级联/归档/闸门重判全部现成 |
| `requiresSourceAcceptance` 单点定义 | `source-contracts.ts:89` | `generated` 自动进入待确认，不写第二份判据 |
| `generatePageImage()` 已存在但**全仓无调用点** | `providers/openai-image.ts:198` | M2 走的是 `scripts/generate-m2-pages.ts` 直调；本任务接入它 |
| `responses.parse` + `zodTextFormat` 结构化输出模式 | `providers/openai-text-assist.ts:64` | 规格的 zod schema 天然就是初稿生成的输出格式 |
| deck 布局 `deck/slides/page-NN/`，`--confirm-upload` 为一次命令一个开关 | `deck/workspace.ts:128`、`index.ts:196` | 新命令沿用，不新造约定 |

### `reference_text` 的格式约束（决定规格条目形状）

`attachReferenceCandidates`（`text-blocks.ts:293`）按**纯文本逐行**消费：每行 trim 后与 OCR 块
双向包含匹配，未匹配的进 `unmatchedReferenceCandidates` 并显示给复核者。

→ **视觉意图绝不能混进 `reference_text`**：「左侧放架构图」会全部落入未匹配列表，
在复核界面表现为一堆假的「漏识别文字」。规格条目必须把页面文字与视觉意图分开存放。

### M2 的实践形状不可沿用（反面证据）

`07-21-evaluation-suite/research/page-prompts.json` 的 25 条形如
`{pageNumber, pageType, title, contentDescription, prompt}`，`prompt` 是整段英文提示词，
中文文字以引号内嵌其中。两条教训：

1. **文字埋在提示词里无法结构化提取**，落不了 `reference_text`。
2. 复杂页（blueprint / architecture / timeline）一页 15+ 条文字，靠「这 6 个是流程阶段」
   「这 3 个是支撑层」的**分组语境**才说得清版式。扁平列表会丢掉这层信息。

（可复用的部分：英文提示词骨架 + 中文文字内嵌引号，25 页已验证有效，本任务沿用该写法。）

### 已识别的缺口（本任务需处理）

- **`replaceSlideSource` 不更新 `reference_text`**（`slide/replace-source.ts:226-236`）：
  沿用旧 reference asset 并把旧 sha 计入指纹。规格文字改动后重生成，该页 `reference_text`
  仍是旧文字，与新图声称的规格不符——「元数据说谎」的同类问题，须在本任务修掉。
- `ProviderCallRecord.stage` 需扩 `init`、`provider` 由 `z.literal("openai")` 放宽为枚举
  （父任务 `design.md` §5 已规定，需求方即③）。
- `WorkspaceAsset.role` 需扩 `content_spec` 与 `generation_prompt`（同上）。
  **两者每次重生成各出一份，必然多代**，必须按〈多代资产与「当前产物」选取契约〉
  选当前产物，禁止裸 `role` 查找。判据取「阶段最后一次成功 attempt」类
  （现成例子 `report/run.ts` 的 `currentSuccessAsset`）。
- `DeckManifest` 无内容规格的位置（`deck-contracts.ts:25`）。

## 已定决策

| ID | 决策 | 结论 | 理由 |
|---|---|---|---|
| E1 | RK2 跨页风格一致性 | **只做 deck 级风格描述段**，拼进每页提示词；一致性作为**显式实证验收点**（实生成 3–4 页比对），不达标再议参考图 | 风格段是 deck 级规格的自然内容，M6 也必然产出它；首页参考图要把**产物指针**写进意图层，M6 就得理解生成产物，接口不再干净，还引入页序依赖与「重生首页是否连带重生全部」的语义难题，技术前提也未验证（`images.edit` 语义是「编辑这张图」且现有封装强制要 mask），会埋第二个 RK1。**风格段是参考图的前置而非替代**：不达标时只需追加可选字段，不必推翻已冻结的结构 |
| E2 | 条目里页面文字的组织 | **分组** `textGroups: [{label, items}]` + 独立 `visualIntent`；`reference_text` 由所有 `items` 展平；标题只是单条目分组，不设专门字段 | 只有分组能让**每条文字只出现一次**。扁平列表丢掉分组语境，用户为修好版式必然把文字重写进 `visualIntent`，造成**隐式分叉**；条目内嵌整段 `prompt` 是同一个病的显式版本，两处不一致时无机制报错 |
| E3 | 规格增删条目后的同步范围 | **只补生成缺失页**。`deck generate` 重跑按 `specEntryId` 对账，报告【新增 / 失联 / 漂移】三类差异，只自动生成新条目对应的页；删除条目对应的页只报告不动手，须显式 `deck remove-slide`。**对账只覆盖 `source.kind === "generated"` 的页**——同 deck 内的 `imported` / `extracted` 页没有 `specEntryId`，既不算失联也不算新增，完全不参与 | 双向同步会让「删错一行规格」静默销毁一页的完整工作量（含已验收产物），且页序插入会动到已有页目录名。对账限定在 generated 页是混合 deck（父任务 A2）成立的前提：否则往混合 deck 跑一次 `deck generate`，所有导入页与抽取页都会被报成「失联」 |
| E4 | `revisionNotes` 累积方式 | **全部累积、全部进提示词**，尾部加引导语「以下调整按时间先后列出，后出现的优先」。清理靠用户直接编辑规格文件 | 调整在用户心智里本就是累积的（「标题大一点」后说「配色改深蓝」是两者都要）。矛盾是少数，且提示词中后出现的指令权重本就更高。只用最后一条会制造更常见的困惑；设上限找不到 N 的依据，截断等于静默丢弃用户写过的意图 |
| E5 | 规格初稿生成的范围 | **模型分页 + 逐页扩写**：输入自由文本（构思/大纲），一次调用输出完整规格（含分页、每页 `textGroups`/`visualIntent`、deck 级风格段）。**无对话** | 与 M6 的边界是「一次性、无对话」，不是「模型能决定多少事」。若用户还得自己分页并写好文字，模型只剩转 JSON，D3「避免全手写」没兑现。输出是文件、可任意编辑，模型的分页**不具约束力** |
| E6 | 规格文件格式 | **JSON** | 条目指纹必须稳定，JSON 有 canonical 序列化的成熟做法；YAML 同一内容有多种等价写法（引号/折行），用户重排格式、语义没变，sha 就变→**误报漂移**。且仓库全用 JSON + zod，与 `responses.parse` 结构化输出同构。手写长文本体验差是代价，但 M5 的调整主路径是「重生成时附一句说明」，直接编辑文件是次要路径，编辑器归 M6 |

### 随决策确定的技术判断（有充分依据，非用户决策）

1. **流程是「规格 → deck」，且建与追加是同一个命令**：
   `deck generate --spec <file> --deck <path>`，deck 不存在则创建，存在则按页序追加末尾。
   依据：父任务 A2 要求交错混合三种来源（1/3 页导入、2 页 PDF、4–6 页生成），
   而 `addSlideToDeck` 只能追加末尾且 `page-NN` 分配后不重排（`deck/add-slide.ts:23`），
   因此混合 deck 靠**按页序依次调用不同来源的命令**实现——③ 必须支持往已有 deck 追加。
   与子任务② 的 `deck extract` 同构（②的 F2）：来源是「维度」而非「链路」，
   建 vs 追加不该按来源分裂成两套命令。
2. **规格文件复制进 deck 工作区**成为 `content-spec.json`，此后 deck 内那份是权威。
   依据：deck 是自包含可重放工作区（M1 起的核心设计），指向外部文件会破坏它；
   漂移检测要比较「deck 内规格的当前指纹」与「生成时快照指纹」，规格须在 deck 内才有稳定归属。
3. **单页重生成走 deck 层按页寻址**，复用 ① 的 `deck replace-source` 模式。
4. **批量生成串行 + 断点续跑 + 进度输出**：网关限流未知，串行最安全；
   `scripts/generate-m2-pages.ts` 已有断点续跑先例。实测过慢再优化并发。
5. **指纹口径：`specEntrySha256` 覆盖「该页生成时的完整规格视图」= deck 级 `style` + 该条目**，
   而非仅条目本身。理由：改 `style` 意味着所有已生成图都过时了，只算条目会**漏报**这种漂移。
   落地方式是 `content_spec` 资产存的就是这个合并视图，指纹即该快照的 sha256——
   如此指纹的定义与资产内容一致，不会分叉。这不违反 A13：A13 约束的是「改**条目**只影响该页」。

## 规格形状（本任务的核心交付，定稿即冻结）

```
ContentSpec {
  schemaVersion: 1
  specId: string
  createdAt / updatedAt: datetime
  style: { description: string }        // deck 级风格约定（E1）：配色/字体气质/版式/图形语言
  entries: ContentSpecEntry[]
}

ContentSpecEntry {
  specEntryId: string                   // 一经分配不得变更；增删页不得影响其它条目
  pageType: string                      // cover/content/transition/... M2 证明对生成有用
  textGroups: [{ label: string, items: string[] }]   // 页面实际文字，展平即 reference_text
  visualIntent: string                  // 版式与视觉意图，只进提示词，绝不进 reference_text
  revisionNotes: string[]               // 机械追加，不引入模型改写（D7）
}
```

## 需求

- **R1 规格契约**：按上述形状落 zod schema 与读写，条目可独立计算指纹（口径见技术判断 5）。
- **R2 逐页生成建 deck / 追加**：`deck generate --spec <file> --deck <path> [--confirm-upload]`
  按条目串行生成、建 slide 工作区、填 `GeneratedSource`，断点续跑，进度与失败逐页可见。
  **deck 不存在则创建，存在则按页序追加末尾，既有页零改动。**
- **R3 规格文字落 `reference_text`**：`textGroups` 展平为逐行文本写入该页 `reference_text`，
  `config.referenceTextPath` 指向它。
- **R4 溯源完整**：提示词全文落 `generation_prompt` 资产、规格视图快照落 `content_spec` 资产、
  Provider 调用记录经 `attemptId` 可追到具体 attempt（父任务 A7）。
- **R5 带调整说明重生成**：`deck regenerate --page N --note "..."`，说明**机械追加**回写该条目的
  `revisionNotes`，随后走 `replaceSlideSource` 换源路径（父任务 A12）。
- **R6 规格漂移检测**：当前规格视图指纹与 `GeneratedSource.specEntrySha256` 不一致即标注漂移，
  在 `deck status` 呈现；**只读派生、不改变任何阶段状态**，改回原样自动消失（父任务 A13）。
- **R7 增删对账**：`deck generate` 重跑时按 `specEntryId` 报告【新增 / 失联 / 漂移】，
  只自动生成新增条目对应的页（E3）。
- **R8 规格初稿生成**：`deck spec-draft --from <文本> -o <file>` 一次调用产出规格（E5）。
- **R9 修掉 `replaceSlideSource` 的 `reference_text` 缺口**：换源可携带新的参考文本，
  且新 sha 计入 `inputFingerprint`。
- **R10 枚举扩展**：`WorkspaceAsset.role` 追加 `content_spec` / `generation_prompt`；
  `ProviderCallRecord.stage` 追加 `init`；`provider` 放宽为具名枚举。均为追加，既有数据继续有效。

## 验收标准

> 覆盖形状照《验收覆盖思考指南》检查。①的教训是「验收止步于哪里，缺陷就藏在哪之后」——
> 以下 C5 / C9 / C10 是专门针对该教训设置的形状，不得简化为「操作成功即通过」。

- [x] **C1 规格读写与指纹**：合法规格可读；条目指纹按技术判断 5 的口径计算；
      改一条条目只有该条目指纹变化；改 `style` 则全部条目指纹变化。
- [x] **C2 逐页生成**：由 N 条条目的规格建出 N 页 deck，每页 `source.kind === "generated"`，
      `specEntryId` / `specEntrySha256` / `promptSha256` 等字段齐备，`deck status` 逐页显示来源。
- [x] **C3 尺寸实测**：生成页的 `source_image` 资产 `image.width/height` 与磁盘 PNG 实际像素
      **逐字节一致**（用例须显式断言，不接受「等于请求参数」）。
- [x] **C4 `reference_text` 落地**：该页 `reference_text` 内容等于 `textGroups` 展平结果，
      `config.referenceTextPath` 指向它；跑 `review` 后规格文字作为候选参与匹配，
      **且 `unmatchedReferenceCandidates` 中不含任何 `visualIntent` 文本**。
- [x] **C5 重生成后下游能继续跑到底**（覆盖形状，不可简化）：
      取一页**跑完完整链路到 `accept-pptx`** 的 `generated` 页 → 带说明重生成 →
      **继续跑 `ocr` → `review` → `mask` 直到 `pptx` 成功**。
      只验到「重生成成功」不算通过。
- [x] **C6 说明回写与累积**：重生成后 `revisionNotes` 追加了该说明；连续三次重生成后
      三条说明按序全在，提示词含全部三条与引导语；规格文件里该条目之外的内容零变化。
- [x] **C7 溯源完整（父任务 A7）**：任取一 `generated` 页，从工作区追出提示词全文、模型版本、
      参数与用量成本，并定位到具体 attempt。
- [x] **C8 漂移只读（父任务 A13）**：编辑第 4 页条目 → 只有第 4 页标注漂移，其余页零变化，
      **所有页阶段状态均不改变**；改回原样后标注消失。再改 `style` → 全部 `generated` 页标注漂移。
- [x] **C9 多代资产判据**（针对①的共同根因）：在一个**已重生成过两次**的页上，
      `content_spec` 与 `generation_prompt` 各有 3 条资产时，读「当前产物」拿到的是最新那条。
      用例须**先断言 fixture 确实是该 role 恰好 3 条**，否则可能什么都没覆盖。
- [x] **C10 增删对账**：规格加 1 条、删 1 条后重跑 `deck generate` →
      报告如实列出【新增 1 / 失联 1】，新增页被建出，**失联页原封不动**（阶段状态与产物零变化）。
- [x] **C14 混合 deck 追加**：向一个已含 `imported` / `extracted` 页的 deck 跑 `deck generate` →
      生成页接在末尾、既有页阶段状态与产物零变化、`page-NN` 不重排；
      **对账报告里不含任何 `imported` / `extracted` 页**（它们没有 `specEntryId`，不参与对账）。
      这条是父任务 A2 混合来源走查能成立的前提。
- [x] **C11 初稿生成**：给一份构思文本，一次调用产出可直接被 C1 读取的合法规格，含分页与风格段。
- [x] **C12 跨页风格一致性实证**（E1 的兑现）：由同一规格实生成 3–4 页，
      人工走查判定风格是否统一到可用。**结论依赖人工质量，按指南只能标 `[~]` 并写明**；
      不达标则记录现象并回父任务议参考图方案，不在实现里自行改方案。
      **实证结果（2026-08-01）**：同一风格段实生成 4 页（封面 / 三栏痛点 / 三层架构 /
      三卡收益，产物在 `gen-deck`）。背景色、电光蓝强调色、细线框 + 发光描边的图形语言、
      中文粗体无衬线标题在四页间**高度一致**，中文文字渲染正确，可用性达标。
      **已观察到的不一致**：标题装饰元素每页不同（封面无装饰、第 2/4 页是折角科技条、
      第 3 页是「//」蓝色斜杠标记）——风格段没有约束这一层，模型每页自由发挥。
      **开发者判定（2026-08-01）：四页均无明显问题，一致性达标。**
      据此 **E1 的参考图回滚点未触发**，规格结构按现状冻结，不追加参考图字段。
      标题装饰逐页不同一事开发者已知悉并接受；若将来要收紧，属风格段表达力的
      增强（可选字段追加），不需要推翻已冻结的结构——这正是 E1 选风格段的理由。
- [x] **C13 既有工作区零影响**：M3/M4 时代的旧 deck 在本任务改动后仍可打开、继续处理、
      `--strict` 导出；`imported` / `extracted` 页不因枚举扩展而校验失败。
      **须在真实历史 deck 上验，不接受仅凭 fixture 推断**（`~/test/ppttest-2026-07-25` 的副本）。

## 不做

- 交互式内容策划（构思 → 对话 → 逐页内容）：归 M6（D3）。
- 规格编辑器：同上。M5 的调整手段是「重生成时附一句说明」+ 直接编辑规格文件。
- 让模型改写规格：D7 明令禁止，只做机械追加。
- 首页风格参考图：见 E1。**C12 实证已通过、开发者判定达标，回滚点未触发，本项确定不做。**
- 生成并发：见技术判断 4。
- 修 `clean/run.ts:329` 的硬编码尺寸：那是 clean 路径的遗留缺陷，与③ 无直接依赖，
  不夹带（子任务① 的教训：机械清理不要混进功能实现）。
