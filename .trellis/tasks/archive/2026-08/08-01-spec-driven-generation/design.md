# 子任务③ 技术设计

父任务契约（`07-31-.../design.md` §2 §5 §6）为唯一上位来源。本文只定③ 自己的部分，
**不改动父任务已定契约**；若发现契约需改，回父任务改（父任务 design §5 的明文要求）。

## 1. 边界

| ③ 拥有 | ③ 不碰 |
|---|---|
| `ContentSpec` 契约与读写、指纹口径 | `SlideSource` / `GeneratedSource` 形状（① 已冻结） |
| 生成 Provider 接入、提示词构造 | 换源的失效级联、归档、闸门重判（① 已实现，直接调用） |
| `deck generate` / `deck regenerate` / `deck spec-draft` | 阶段图（父任务 §5：③ 不得新增处理阶段） |
| 漂移检测的计算与呈现（CLI 侧） | 桌面端呈现（归子任务④） |

## 2. `ContentSpec` 契约

### 2.1 位置

新建 `packages/core/src/content-spec-contracts.ts`。放 core 而非 CLI 的理由：
它是跨里程碑契约，M6 策划侧与子任务④ 的桌面端都要读它，CLI 不该是唯一持有者。

带 `schemaVersion: 1`（与 `SCHEMA_VERSION` 同源）。这与 `SlideSource` 刻意不带版本号
**不矛盾**：`SlideSource` 是 manifest 的一个属性、随宿主走，而 `content-spec.json` 是
独立可寻址文件，M6 极可能扩展它，需要自己的版本轴。

### 2.2 形状

见 `prd.md`〈规格形状〉。三条约束在 schema 层面固化：

- `specEntryId` 在一份规格内唯一（`superRefine` 校验，重复即拒绝加载）。
- `textGroups[].items[]` 每条 `.min(1)` 且不含换行——展平后每条**恰好占 `reference_text` 一行**，
  内嵌换行会让一条文字被 `attachReferenceCandidates` 拆成两个候选。
- `revisionNotes` 只增不改由写入路径保证，schema 不做限制（用户可直接编辑文件清理，E4）。

### 2.3 指纹口径（关键）

**`specEntrySha256` 覆盖「该页生成时的完整规格视图」= deck 级 `style` + 该条目**。

计算方式**不做通用 canonical JSON**，而是按 schema 显式列字段喂给既有
`sha256Values`（`slide/workspace.ts:107`，长度前缀式稳定哈希）：

```
specViewFingerprint(style, entry) = sha256Values([
  "style:" + style.description,
  "entryId:" + entry.specEntryId,
  "pageType:" + entry.pageType,
  ...entry.textGroups.flatMap(g => ["group:" + g.label, ...g.items.map(i => "item:" + i)]),
  "intent:" + entry.visualIntent,
  ...entry.revisionNotes.map(n => "note:" + n),
])
```

三个理由：

1. **用户重排 JSON 键不改变指纹**——通用 canonical JSON 也能做到，但显式列字段还顺带
   保证「新增字段必须显式决定是否进指纹」，不会因为加了个字段就静默改变所有历史页的漂移判断。
2. 与仓库现有指纹做法同构（`inputFingerprint` 就是这么算的）。
3. 前缀标签（`group:` / `item:`）避免不同结构拼出同一串——
   `{label:"a", items:["b"]}` 与 `{label:"a b", items:[]}` 不会碰撞。

**改 `style` 会让全部条目指纹变化**，即全部 `generated` 页标注漂移。这是正确的：
风格段变了，所有已生成图确实都过时了。只算条目会**漏报**这种漂移。
不违反父任务 A13——A13 约束的是「改**条目**只影响该页」。

### 2.4 落盘位置

- deck 级：`<deck>/content-spec.json`。`deck generate --spec <外部文件>` 时复制进来，
  此后 deck 内那份是权威（prd 技术判断 2）。
- slide 级快照：`content_spec` 资产，存的就是 §2.3 那个**合并视图**（`{style, entry}`），
  不是裸条目。如此「资产内容」与「指纹覆盖范围」完全一致，不会分叉。

`DeckManifest` **不新增字段**：规格是 deck 目录下的约定路径，与 `slides/` 同级。
理由是 `DeckManifest` 目前只描述页面集合与导出记录，塞进规格指针会让它同时承担两种职责，
且规格文件缺失时 manifest 会变成「指向不存在文件」的悬空引用。约定路径没有这个问题——
文件在不在，`stat` 一次即知。

## 3. 生成流程

### 3.1 `deck generate --spec <file> --deck <path> [--confirm-upload]`

**deck 不存在则创建，存在则按页序追加末尾**（与子任务② 的 `deck extract` 同构）。
追加时既有页零改动：只往 `manifest.slides` 末尾 push，`page-NN` 由 `nextPageNumber`
分配、不重排（`deck/add-slide.ts:23`）。父任务 A2 的交错混合 deck 即靠按页序
依次调用不同来源的命令实现。

**对账只覆盖 `source.kind === "generated"` 的页**。同 deck 内的 `imported` / `extracted`
页没有 `specEntryId`，既不算失联也不算新增——否则往混合 deck 跑一次 `deck generate`，
所有导入页与抽取页都会被报成「失联」。

```
读规格 → 复制进 deck（或对账已有的）
  → 逐条目串行：
      构造提示词 → images.generate → 落临时 PNG
        → createSlideWorkspace({imagePath, source: generated draft, referencePath})
        → 写 content_spec / generation_prompt / provider_record 资产
  → 汇总报告【建立 N 页 / 跳过 M 页 / 失败 K 页】
```

- **串行 + 断点续跑**：已存在且 `specEntryId` 匹配的页跳过（幂等重跑）。
  网关限流未知，串行最安全；`scripts/generate-m2-pages.ts` 已有先例。
- **单页失败不中断整批**：记录失败原因继续下一条，退出码按「至少建立一页」判定不失败——
  与父任务 §7 对 PDF 抽取的 D2 口径一致，同一份产品直觉。
- **尺寸实测**由 `createSlideWorkspace` 内的 `assertWideImage` + sharp metadata 完成，
  ③ 一行尺寸都不自己填（RK1 衍生约束 1）。
- **16:9 校验也在那里**：生成图若某次落在容差外，该页失败并报告实际尺寸，不静默裁剪。

### 3.2 提示词构造

沿用 M2 已验证的写法：英文骨架 + 中文文字内嵌引号。

```
[deck 级 style.description]
[pageType 对应的版式提示]
Texts that must appear on the page, grouped by role:
  <label>: '<item>', '<item>', ...
Visual intent: <visualIntent>
Revision notes (listed in chronological order, later ones take precedence):
  1. <note>  2. <note> ...
```

- `promptVersion` 常量化（如 `m5-generate-v1`），随提示词骨架变更递增。
- 提示词**全文**落 `generation_prompt` 资产；`GeneratedSource.promptSha256` 只存指纹
  （父任务 §2 已定：全文另存资产，字段里只放指纹）。

### 3.3 `deck regenerate --page N --note "..."`

```
把 note 机械追加进该条目 revisionNotes → 写回 deck 内 content-spec.json
  → 用新的规格视图构造提示词 → 生成新图
  → replaceSlideSource({imagePath, source: generated draft, referencePath: 新的展平文字})
```

复用 ① 的换源路径，因此**失效级联、产物归档、`accept-source` 重判全部自动获得**，
③ 不重写任何一行。`specEntrySha256` 用**追加 note 之后**的新指纹——
否则刚生成完就立刻显示漂移。

## 4. `replaceSlideSource` 的 `reference_text` 缺口（R9）

现状（`slide/replace-source.ts:226-236`）：沿用旧 reference asset，旧 sha 计入 `inputFingerprint`。
规格文字改了重生成，该页 `reference_text` 仍是旧文字。

改法：`ReplaceSlideSourceOptions` 增加可选 `referencePath`。给了就写入新的
`reference_text` 资产（`inputs/reference-<n>.txt`，编号与源图同规则）、更新
`config.referenceTextPath` 与 `manifest.referenceTextAssetId`，并把**新** sha 计入指纹；
不给则维持现状（`imported` 换源不受影响）。

旧的 reference 资产**保留不删**——与源图同一处理原则（换源保留旧资产供追溯）。
这意味着 `reference_text` 也会多代，消费方须按 `referenceTextAssetId` 显式指针取，
不得裸 `role` 查找（现成的显式指针判据，与 `sourceImageAssetId` 同型）。

这是本任务对 CLI 内部 API 的扩展，**不是父任务契约变更**（`SlideSource` 未动）。

## 5. 漂移检测

纯派生计算，不落盘、不改状态：

```
对每个 kind === "generated" 的页：
  当前视图指纹 = specViewFingerprint(deck 内 style, 该 specEntryId 对应条目)
  漂移 = 当前视图指纹 !== source.specEntrySha256
  条目找不到 = 失联（E3 的三类差异之一）
```

在 `deck status` 呈现。**不自动失效任何阶段**（父任务 §6.2）。
「改了又改回来」天然由 sha 比较处理，无需状态复位逻辑。

## 6. 多代资产的当前产物判据

`content_spec` 与 `generation_prompt` 每次生成各出一份，**必然多代**。
按〈多代资产与「当前产物」选取契约〉，本任务用**「阶段最后一次成功 attempt」**类判据，
现成例子是 `report/run.ts` 的 `currentSuccessAsset`：

```
当前 content_spec = assets.find(a =>
  a.role === "content_spec" && a.attemptId === initStage.lastSuccessfulAttemptId)
```

不用显式指针类（不值得为它在 manifest 加两个字段），不用固定路径类
（每代都要留存，不能互相覆盖）。

**禁止** `assets.find(a => a.role === "content_spec")`。

## 7. 枚举扩展与兼容

三处**追加**，既有数据继续有效（父任务 §5 已规定）：

| 枚举 | 追加 | 波及 |
|---|---|---|
| `WorkspaceAsset.role` | `content_spec`、`generation_prompt` | 纯追加，旧数据不含这两个值 |
| `ProviderCallRecord.stage` | `init` | 纯追加 |
| `ProviderCallRecord.provider` | `z.literal("openai")` → `z.enum([...])` 含 `openai` | **放宽**：旧值 `"openai"` 仍合法 |

零迁移：不动 `SCHEMA_VERSION` / `workspaceVersion` / `deckVersion`，不新增阶段
（父任务 §5 明确 `accept-source` 是唯一阶段改动，③ 不得再加）。

`provider` 由 literal 放宽为 enum 是本任务唯一的**放宽**而非追加，须确认无消费方依赖
「该值必为字面量 openai」做类型收窄——实现时先 grep 确认。

## 8. 权衡与回滚点

- **最大回滚点是 C12（跨页风格一致性）**。若实证不达标，按 E1 回父任务议参考图方案，
  **不在实现里自行改方案**。此时 R1–R11 其余部分均已可交付，规格只需追加可选字段，
  已冻结的结构不必推翻——这正是 E1 选风格段而非参考图的核心理由。
- **规格形状定稿即冻结**。M6 接上时生成侧不应改动，因此 §2 的每个字段都要能回答
  「M6 策划侧产出它是否自然」。`pageType` 与 `textGroups[].label` 是自由字符串而非枚举，
  就是为此——枚举会让 M6 撞上「我要的页型不在枚举里」。
- **不做的**：并发生成、规格编辑器、模型改写规格、首页参考图、
  修 `clean/run.ts:329`（见 `prd.md`〈不做〉）。
