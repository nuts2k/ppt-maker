# 跨层契约

## 场景：M0 CLI、离线 OCR 与 PPTX 技术边界

### 1. Scope / Trigger

- 触发条件：新增或修改 CLI 签名、核心 Schema、外部 OCR 进程 JSON、16:9 校验、像素坐标换算或 PPTX 默认字体行为。
- 适用范围：`packages/core`、`apps/cli`、`native/macos-vision-ocr` 之间的跨层数据流。
- 不适用：M1 文字分类/去字策略、M3 数据库和 M4 前端状态。

### 2. Signatures

CLI：

```text
ppt-maker doctor [--json]
ppt-maker probe image <image>
ppt-maker probe ocr <image> [-o|--output <path>] [--binary <path>]
ppt-maker probe pptx <image> -o|--output <path> [--font-face <name>]
```

核心函数：

```ts
validateWideAspectRatio(dimensions, tolerance?): AspectRatioValidation
assertWideAspectRatio(dimensions): void
pixelsToPptxBox(box, image): SlideBoxInches
collectDoctorReport(dependencies): DoctorReport
runVisionOcr(imagePath, binaryPath?): Promise<OcrProbeResponse>
createPptxProbe(options): Promise<string>
```

Provider 接口：

```ts
interface OcrProvider {
  readonly id: string;
  recognize(request: {
    readonly imagePath: string;
    readonly languages: readonly string[];
  }): Promise<OcrProbeResponse>;
}
```

### 3. Contracts

所有可持久化/跨进程对象当前使用 `schemaVersion: 1`。

`OcrProbeResponse`：

```ts
{
  schemaVersion: 1;
  provider: "apple-vision";
  image: { width: positiveInt; height: positiveInt };
  blocks: Array<{
    id: nonEmptyString;
    text: nonEmptyString;
    bboxPx: { x: nonNegative; y: nonNegative; width: positive; height: positive };
    confidence: numberBetween0And1;
    rotationDeg: finiteNumber | null;
    // Vision 子串框派生的字符/子串定位提示，缺省回填 []。
    glyphHints: Array<{
      text: nonEmptyString;
      // 四点顺序固定为左上、右上、右下、左下，源图左上角原点像素系。
      quadPx: [PointPx, PointPx, PointPx, PointPx];
    }>;
  }>;
}
```

`glyphHints` 只是下游 mask 局部分割的先验，不是精确字形轮廓，也不保证覆盖每个字符；类型名、字段名和注释一律使用“提示（hints）”措辞。`glyphHints` 属于 OCR 阶段输出的一部分，OCR 输入指纹的 Schema 标记为 `apple-vision-ocr-schema:2`，输出结构演进时使 OCR 及已完成下游 stale。

`TextBlock` 除 OCR 字段外，还必须表达 `classification`、`sources`、`includeInMask`、`reviewStatus` 和可空 `updatedAt`。OCR 文本和原始文案都只是候选来源；图片中实际可见内容经人工复核后才是最终值。

坐标契约：源图片左上角为原点，单位为像素；bbox 必须完全位于图片内。PPTX 固定 wide 16:9，尺寸为 `13.333 × 7.5` 英寸，按 x/width 和 y/height 分别线性换算，不裁剪、拉伸或补边。允许的 16:9 相对误差为 `0.005`。

环境键：M0 没有必须的环境变量。Apple Vision 使用显式二进制路径或仓库内默认 `.build/macos-vision-ocr`；字体默认 `Microsoft YaHei`，人工覆盖必须通过 `--font-face` 明示。

### 4. Validation & Error Matrix

| 条件 | 行为/错误 |
|---|---|
| 宽或高不是正有限数 | `INVALID_DIMENSIONS` |
| 容差为负数或非有限数 | `INVALID_DIMENSIONS` |
| 图片超出 16:9 相对容差 | `INVALID_ASPECT_RATIO`；图片探针以退出码 1 报告 |
| bbox 非正尺寸、负坐标或越界 | `INVALID_BOUNDING_BOX` |
| Swift stdout 不是合法 JSON/Schema | 解析或 Zod 错误，CLI 退出码 1 |
| Vision 二进制不存在 | 明确提示先运行 `pnpm build:vision`，CLI 退出码 1 |
| 默认微软雅黑预检失败 | `MISSING_DEPENDENCY`，阻止 PPTX 生成 |
| 显式给出 `--font-face` | 允许人工覆盖默认字体门禁 |
| `doctor` 只有 warn | 正常输出，退出码 0 |
| `doctor` 至少一个 fail | 正常输出报告，退出码 1 |

### 5. Good / Base / Bad Cases

- Good：1600×900 PNG/JPEG，Vision 返回版本 1 的中英文块，bbox 在图内；结果通过 Schema 并可写出 JSON。
- Base：Vision 无法提供可靠旋转角度，返回 `rotationDeg: null`，不推断为 0；Node 25 被 doctor 标为 warn，但仍可查看其他环境项。
- Bad：把非 16:9 图片送入 OCR/PPTX、接受越界 bbox、在字体缺失时静默回退、把原始文案直接覆盖实际 OCR 内容。

### 6. Tests Required

- 单元测试：16:9 精确值、容差边界、非法尺寸、bbox 边界与越界；断言具体错误码和换算值。
- Schema 测试：有效 `TextBlock`/manifest/OCR/doctor 报告通过；空文字、错误哈希、越界置信度或错误版本失败。
- CLI 测试：doctor 的 pass/warn/fail 汇总，微软雅黑缺失门禁和显式覆盖；PNG/JPEG 元数据；OCR 在调用二进制前拒绝非 16:9。
- 集成探针：Swift 构建、受控图片离线 OCR、PPTX ZIP/XML 关键结构。
- 人工验证：PowerPoint for Mac 可打开，页面 16:9，文本框原生可编辑，东亚/ASCII 字体属性均为 `Microsoft YaHei`。

### 7. Wrong vs Correct

#### Wrong

```ts
const response = JSON.parse(stdout) as OcrProbeResponse;
const rotationDeg = response.blocks[0].rotationDeg ?? 0;
```

这会信任外部进程并把“未知旋转”伪造成 0 度。

#### Correct

```ts
const response = OcrProbeResponseSchema.parse(JSON.parse(stdout));
const rotationDeg = response.blocks[0]?.rotationDeg ?? null;
```

外部响应先经过运行时校验，未知值保持显式 `null`。

## 场景：M1 单页工作区与离线 OCR 阶段

### 1. Scope / Trigger

- 触发条件：新增或修改 `slide init`、`slide ocr`、页面工作区 Schema、资产哈希、阶段 DAG、输入指纹、复用或下游失效行为。
- 适用范围：`packages/core/src/workspace-contracts.ts`、`stage-graph.ts` 和 `apps/cli/src/slide/`。
- 当前已验证 init、离线 OCR 和显式云端视觉分析；mask、clean plate 和正式 PPTX 阶段不得伪造成已实现。

### 2. Signatures

```text
ppt-maker slide init <image> --workspace <path> [--reference <path>]
ppt-maker slide ocr <workspace> [--binary <path>]
ppt-maker slide analyze <workspace> --confirm-upload
```

```ts
createSlideWorkspace(options): Promise<LoadedSlideWorkspace>
loadSlideWorkspace(path): Promise<LoadedSlideWorkspace>
assertWorkspaceAssetIntegrity(workspace, asset): Promise<void>
runSlideOcr(options): Promise<{ outputPath; attemptId; reused }>
analyzeSlideVision(options): Promise<OpenAiVisionAnalysis>
runSlideAnalyze(options): Promise<{ outputPath; attemptId; reused }>
invalidateStageAndDownstream(states, stage, reason, time): WorkspaceStageState[]
isStageReusable(state, inputFingerprint): boolean
```

### 3. Contracts

- `manifest.json` 与 `config.json` 均为 `schemaVersion: 1`，`slideId` 必须一致。
- 工作区持久化路径统一使用正斜杠相对路径；禁止绝对路径、盘符、反斜杠和 `..` 段。
- 每项资产记录 `id`、相对路径、角色、SHA-256、字节数、创建时间、产生阶段、attempt ID 和可空图片元数据。
- 每个阶段保存当前状态、最新 attempt、最后成功 attempt、成功输入指纹和失效原因。
- attempt 保存阶段、序号、状态、输入指纹、时间、Provider/版本、资产 ID 和结构化错误；失败 attempt 不覆盖旧资产。
- init 原子生成新工作区，源图复制到 `inputs/source.<format>`，可选参考文案复制到 `inputs/reference.txt`。
- OCR 输入指纹至少包含源图哈希、Vision 二进制哈希和 OCR Schema 版本；指纹一致且产物完整时复用，变化时 OCR 及已完成下游变为 stale。
- OCR 完全离线，输出写入 `stages/ocr/ocr-NNN/result.json`，先原子写文件，再登记资产。
- 云端视觉固定使用 `openai@6.48.0`、Responses API、`gpt-5.6-sol`、`detail: "original"`、`reasoning.effort: "high"`、`store: false` 和 `zodTextFormat` Structured Outputs。官方契约见 [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) 与 [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。
- `slide analyze` 只在显式确认后发送完整页面 data URL、OCR 候选和可选参考文案；API Key 只用于 SDK 客户端，不进入请求对象、工作区或错误记录。
- 每次 analyze 尝试分别保存 Schema 校验后的结果、原始响应和去敏 Provider 记录；Provider 记录包含发送资产哈希、模型参数、提示词版本、请求 ID、用量、耗时和错误。

### 4. Validation & Error Matrix

| 条件 | 行为/错误 |
|---|---|
| 输入不是 16:9 PNG/JPEG | 复用图片校验错误，目标工作区不生成 |
| 目标工作区已存在，包括空目录 | `WORKSPACE_ALREADY_EXISTS`，不得替换 |
| manifest/config 的 `slideId` 不一致 | `INVALID_WORKSPACE` |
| 资产字节数或 SHA-256 变化 | `ASSET_INTEGRITY_MISMATCH` |
| 相对路径越出工作区 | `PATH_OUTSIDE_WORKSPACE` |
| OCR 的 init 前置阶段未完成 | `INVALID_STAGE_STATE` |
| Vision 二进制不存在或响应无效 | attempt 标记 failed，不生成 OCR 资产，CLI 退出码 1 |
| OCR 输入和成功指纹一致 | 返回既有成功 attempt 的路径，`reused: true` |
| analyze 缺少 `--confirm-upload` | `UPLOAD_CONFIRMATION_REQUIRED`，不创建 attempt、不访问网络 |
| `OPENAI_API_KEY` 缺失 | `MISSING_DEPENDENCY`，失败 attempt 和 Provider 记录保留 |
| Responses API refusal/空解析/Schema 错误 | `INVALID_PROVIDER_RESPONSE`，不得把自由文本当作候选 |
| analyze 输入、模型和提示词版本未变化 | 复用最后成功结果，不再次上传 |

### 5. Good / Base / Bad Cases

- Good：1600×900 PNG 初始化新目录，真实 Apple Vision 输出通过 Schema，manifest 登记 `ocr-001` 和结果哈希。
- Base：相同源图和相同 Vision 二进制再次运行，直接复用 `ocr-001`，不新增 attempt。
- Base：同一 OCR、源图、参考文案、模型和提示词再次 analyze，复用 `analyze-001`，不再次计费。
- Bad：用 POSIX `rename` 直接把临时工作区覆盖到已存在的空目录；用普通 `writeFile` 覆盖上一轮 OCR 结果；或在没有 `--confirm-upload` 时自动上传低置信度页面。

### 6. Tests Required

- Schema：相对路径、完整阶段集合、人工接受记录哈希绑定的有效/无效样例。
- 阶段图：依赖顺序、初始状态、下游 stale、未完成前置拒绝和指纹复用。
- 工作区：PNG/JPEG 初始化、非 16:9 拒绝、非空/空目录拒绝覆盖、资产篡改检测。
- OCR：fake Vision 成功、同输入复用、二进制缺失失败留痕、Provider 哈希变化使下游 stale。
- OpenAI Provider：固定模型/detail/reasoning/store、Zod 结果、refusal/空解析拒绝和 API Key 不进入请求。
- analyze 阶段：显式上传门禁、成功三类产物、同输入复用、失败 Provider 记录和敏感信息不落盘。
- 运行时：相关测试和真实 `slide init → slide ocr` 链路必须在 Node.js 24 与 macOS Apple Vision 下通过。

### 7. Wrong vs Correct

#### Wrong

```ts
await writeFile("stages/ocr/result.json", JSON.stringify(result));
await rename(temporaryWorkspace, workspacePath);
```

固定路径会覆盖旧产物，且 POSIX `rename` 可能替换已存在的空目录。

#### Correct

```ts
await assertWorkspaceDoesNotExist(workspacePath);
await writeJsonAtomic(`stages/ocr/${attemptId}/result.json`, result);
await writeWorkspaceManifest(workspacePath, completedManifest);
```

每次尝试使用独立路径，文件原子替换，manifest 只在产物落盘并校验后登记。

## 场景：M1 复核、mask、clean plate、PPTX 与报告阶段

### 1. Scope / Trigger

- 触发条件：新增或修改 review 合并、validate-review、mask、clean plate、PPTX 合成、accept 门、report 或 `run --from` 编排的契约、指纹规则、上传门禁或人工接受语义。
- 已由真实代码验证：候选合并生成 `stages/review/text-blocks.json`、validate-review 结构化校验、自动字形 mask（sharp + TS 像素算法）、gpt-image-2 clean plate、微软雅黑 PPTX 合成 + ZIP/XML 自动检查、两道人工接受门、分阶段报告、增量重跑编排。

### 2. Contracts

阶段 DAG（`workspace-contracts.ts` 的 `SlideStage`）：`init → accept-source → ocr → analyze(可选) → review → mask → clean → accept-clean → pptx → accept-pptx → report`。全部可持久化对象为 `schemaVersion: 1`。

- `SlideSource`（`source-contracts.ts`，落在 slide manifest 的 `source` 字段，deck 不冗余存）：按 `kind` 判别联合 `imported | extracted | generated`，三分支共有 `recordedAt` 与 `attemptId`（锚定到具体一次 `init` attempt，换源历史因此经 `attempts` 数组天然可追溯）。成本与用量**不进本契约**，由 `ProviderCallRecord` 持有，经 `attemptId` 关联。`generated` 的规格指纹必须是**条目级**（`specEntrySha256`）——整份文件级指纹会让改一页污染全 deck 的漂移判断。
- **零迁移铁律**：`source` 与 `accept-source` 阶段状态对旧 manifest 缺省，由 `normalizeSlideManifest` 在 `SlideWorkspaceManifestSchema.parse` **之前**补齐。顺序颠倒则 `superRefine` 的阶段完整性校验先行报错，M3/M4 时代的每一个工作区都会加载失败。归一化只在内存中进行，只读命令不改动旧工作区磁盘；首次写操作时新字段自然落盘，没有独立迁移程序。
- **当前源图只认 `sourceImageAssetId`**：换源保留旧图资产（供追溯），`assets` 里会有多条 `source_image`。任何按 `role` 取首条的读法拿到的都是已被替换掉的那张，界面会在换源后继续显示旧图。**这不是源图独有的**——换源与阶段重跑会让多个 role 同时出现多代资产，完整判据见《多代资产与「当前产物」选取契约》一节（2026-08-01 走查在 `review_validation`、`ocr_result`、`source_acceptance` 上各实证了一次同类缺陷）。

- `TextReviewDocument`（`stages/review/text-blocks.json`，唯一人工编辑入口）：`slideId`、`image`、`generatedAt`、`reviewStartedAt`（首次候选时间，跨重跑保留）、`blocks[]`、`unmatchedReferenceCandidates[]`。每个 `TextReviewBlock`：`id`、`text`、`lines`、`bboxPx`、`quadPx|null`、`rotationDeg`、`zIndex`、`classification(layout_text|object_integrated_symbol|uncertain)`、`sources[]`（offline_ocr/cloud_vision/reference_text/manual 带来源）、`includeInMask`、`reviewStatus(unreviewed|reviewed|accepted_with_risk)`、`riskAcceptance|null`、`style`、`maskParams`、`updatedAt`。合并保留既有人工确认值，不静默覆盖（**边界**：该规则约束的是**同一源图下的重跑合并**。换源改变的是源图本身，旧图上的人工判断对新图不成立，继承它不是保留成果而是把过期结论冒充为当前结论。`replaceSlideSource` 默认把复核稿按 attempt 归档到 `stages/review/archived/<initAttemptId>/`，`readExistingReview` 读固定路径拿不到即不继承；`--keep-review` 是用户显式选择，因此同样不构成静默覆盖）；逐字符 `glyphHints` 不进复核文件，由 mask 从 OCR 产物按 bbox 重叠读取作软先验。
- `TextReviewValidationReport`（`stages/review/validation.json`）：`status(passed|failed)`、`documentSha256`（被校验文件哈希，作为 mask 消费门禁锚点）、`violations[]`（blockId/field/code/message/severity）。规则：`includeInMask` 仅 `layout_text`；bbox/quad 界内且四边形非退化；旋转 `≤±360`；字号 `≤` 页高；`accepted_with_risk` 须有 riskAcceptance 且状态一致；未复核版式文字为 warning（硬门禁在 mask/pptx）。
- `MaskRecord`（`stages/mask/record.json`）：`algorithmVersion`、`sourceImageSha256`、`reviewDocumentSha256`、`reviewValidationSha256`、`maskedBlockIds[]`、`blocks[]`（每块 maskedPixels/bboxAreaPx/coverageRatio）、`totals`、`outputs`（mask/preview/overlay 哈希）。mask PNG 为源图同尺寸带 alpha，字形 `alpha=0`（gpt-image-2 待编辑语义）。
- `CleanAttemptRecord`（`stages/clean/clean-NNN/record.json`）：`model=gpt-image-2`、`promptVersion`、`size=2048x1152`、`quality=high`、`outputFormat=png`、`sourceImageSha256`、`maskSha256`、`resultSha256`、`requestId`、`usage`、`durationMs`、`checks`（size/textResidue/outsideMaskDiff/containerRingDiff 离线数值）。多次尝试序号递增不覆盖。
- `PptxCheckReport`（`stages/pptx/check.json`）：`status`、`layout`（cx/cy EMU + 16:9）、`shapes`（images=1 背景图 + textBoxes=N）、`fontDeclared`、`missingTexts[]`。仅 `layout_text` 且已复核块生成微软雅黑文本框；坐标经 `pixelsToPptxBox` 换算，字号 `fontSizePx × 72 × 13.333 / 源图宽` 磅。
- `ArtifactAcceptance`（`stages/source/accepted.json`、`stages/clean/accepted.json`、`stages/pptx/accepted.json`）：`stage(accept-source|accept-clean|accept-pptx)`、`artifactAssetId`、`artifactSha256`、`upstreamFingerprint`（对应阶段完成指纹）、`acceptedBy`、`note`、`checklist`。三个验收门是同一契约的三个实例，新增验收门照此结构落地，不另造机制。
  - **自动放行不得伪造人工痕迹**：`imported` / `extracted` 的 `accept-source` 置 `completed`，但**不写** `accepted.json`、不建验收资产，事实只记在该阶段 attempt 的 `provider: "auto-source-trust"` 上。写一条 `acceptedBy` 指向系统的记录，等于让报告声称「这页源图有人确认过」而事实没有。判据就是磁盘上这个文件在不在。
- `SlideReport`（`stages/report/report.json`）：`overallStatus(complete|incomplete)`、`discovery`、`classification`、`mask`、`autoChecks`（自动检查）与 `manualAcceptance`（人工接受）分区、`providerCalls`、`manualReview`（reviewStartedAt→pptx 接受耗时）。任何未通过/未完成不汇总为 complete。

### 3. 指纹与失效投影（design §6）

- mask 输入指纹 = `sha(源图sha + maskInvalidationProjection(review) + OCR产物sha + 算法版本)`。投影只含每块 `{id,bboxPx,quadPx,rotationDeg,classification,includeInMask,maskParams}`；`text/lines/style/reviewStatus/riskAcceptance/zIndex/updatedAt` 不在投影内。
- clean 输入指纹 = `sha(源图sha + maskAsset.sha256 + 模型 + 提示词版本 + size/quality/format)`，不含整复核文件哈希。
- pptx 输入指纹含整复核文件哈希（内容/样式影响文本层）。
- 结论：仅改文字内容/样式 → mask/clean 复用、只重跑 PPTX；改几何/分类/mask 参与/mask 参数 → mask 及全部下游重跑。上游阶段以变化后指纹重跑时经 `invalidateStageAndDownstream` 把下游（含 accept 记录对应阶段）标记 stale。

### 4. 上传门禁、脱敏与人工门

- `analyze` 与 `clean` 必须显式 `--confirm-upload`，否则 `UPLOAD_CONFIRMATION_REQUIRED`；上传前打印将发送的文件与 sha。`run --from` 绝不自动触发上传阶段，遇上传/人工门停止并提示下一条命令。
- API Key 只从 `OPENAI_API_KEY` 读取；Provider 记录与错误 details 落盘前用 `split(apiKey).join("[REDACTED]")` 脱敏；sentAssets 只存 `{path, sha256}` 不落图片内容。
- mask 消费门禁：存在 `review_validation` 且 `status=passed` 且 `documentSha256 == 当前 text-blocks.json 实时 sha`；`includeInMask` 块须已复核（硬门禁）。
- clean 上游门禁：mask/mask_record 资产完整性。pptx 上游门禁：accept-clean completed（非 stale）+ 接受记录 `artifactSha256 == 当前 clean_plate 资产 sha`；所有 layout_text 已复核；微软雅黑预检（缺失且无 `--font-face` 备用则 `MISSING_DEPENDENCY` 阻断，显式备用记录偏离）。
- accept 哈希锚定：`accept-clean/accept-pptx` 只接受当前尝试产物（校验完整性），`upstreamFingerprint` 绑定阶段完成指纹；上游重跑经 DAG 使接受阶段 stale，accepted.json 不删除但状态失效。

### 5. Tests Required

- 候选合并/冲突/人工值保留、validate-review 各类违规、mask 算法（CCL/膨胀/多边形/分割）与像素统计基线、glyphHints 软先验收窄、clean fake editor 全链路（成功/失败/脱敏/多尝试/完整性拒绝）、pptx 门禁与自动检查、accept 哈希锚定与 stale、变更粒度失效矩阵、run --from 停止点、report 汇总规则、合成 fixture 五类元素端到端覆盖。

## 场景：阶段落库与强制重跑契约（M4 E4 端到端走查验证）

### 1. Scope / Trigger

- 触发条件：新增或修改任一阶段的收尾落库、`run --from` 的跳过规则、阶段复用判据，或任何「让已完成阶段重做」的路径。
- 已由真实代码验证：`report` 阶段漏写状态导致恒 pending（缺陷 6）、人工拒绝验收无法触发重跑（缺陷 5）。两者均在无 GUI 的单元测试中未被发现，直到真实 deck 端到端走查才暴露。

### 2. Signatures

```ts
// apps/cli/src/slide/invalidate.ts
export async function invalidateSlideStage(options: {
  readonly workspacePath: string;
  readonly stage: SlideStage;
  readonly reason: string;          // 非空，落入 invalidationReason
}): Promise<{ readonly invalidated: readonly SlideStage[] }>;

// desktop IPC（channels.ts / preload / main）
"slide:invalidate-stage"(workspacePath: string, stage: RunStage, reason: string)
  => Promise<{ invalidated: string[] }>
```

### 3. Contracts

**每个阶段的收尾必须同时写三样，缺一不可**：

| 写入项 | 内容 | 漏写的后果 |
|---|---|---|
| `assets` | 产物资产 | 下游找不到产物 |
| `stages` | `status: "completed"` + `lastSuccessfulAttemptId` + `completedInputFingerprint` | **阶段恒为 pending**：每次 run 都重跑、每次都成功、每次都不改状态，UI 上是「点了没反应」 |
| `attempts` | 递增编号的 attempt 记录 | 耐久层错误与耗时统计读不到东西 |

`report` 曾只写 `assets`，是全流水线唯一的例外，即上述缺陷 6。纯本地、毫秒级、无中断窗口的阶段（如 `report`）可直接写 `completed`，不必走「先 running 再 replace」的两段式；有外部调用或耗时的阶段必须两段式，否则中断后无记录。

**「跳过」与「重做」由同一个判据决定，两处都只认 `completed`**：

- `isStageReusable(state, fingerprint)` = `status === "completed" && completedInputFingerprint === fingerprint`（阶段函数内部的产物复用）
- `run-from.ts` 各阶段守卫 = `stageState(...)?.status !== "completed"`（编排层的跳过）

因此**只要状态还是 `completed`，任何形式的「重跑」都会被静默跳过**——执行器一路滑到下一个人工闸门原地返回，日志上表现为 run 在毫秒内 `run-start → page-done` 且**没有任何 `stage-start`**。

**「各阶段守卫」是每个分支的义务，不是某几个分支的特权**（M5 阶段三走查验证，2026-08-02）。上面那条 `run-from.ts` 守卫写的是「各阶段」，但实现里长期只挂在 `assist-review` / `clean` / `accept-pptx` 三个分支上。其余分支分两类：

| 分支 | 漏挂守卫的实际后果 |
|---|---|
| `ocr` / `review` / `mask` / `pptx` | 函数内部有 `isStageReusable` 兜底，产物字节不变、attempt 不增，**代价只是空跑** |
| **`report`** | **内部没有任何复用**，每次重写 `report.json`（新 `generatedAt`）并追加一条 attempt |

于是一份 11 页全 completed 的 deck，每跑一次 `deck run` 就有 11 页的目录指纹全变（`manifest.json` + `report.json` + `validation.json` 三个文件），实测 `report` attempt 已累积 9 条而其它阶段各 1 条。危害有三层，一层比一层深：

1. attempts 无界增长；
2. **打穿「已完成页零变化」这个不变量**——所有靠 `snap.sh` 比对目录 shasum 的判据（换源隔离、追加不影响既有页、规格漂移不污染其它页）都会被它污染成假阳性；
3. 「report 有新 attempt」不再能说明这一轮真做了事，与《静默失败诊断指南》的判据直接冲突。

**内部有 `isStageReusable` 不能替代编排层守卫**：前者保的是产物字节，后者保的是「这一轮到底跑没跑」。两者缺一，`report` 这种没有指纹复用的阶段就会漏网。

**瞬态阶段（`validate-review`）的处理另有一条**：它不落 `stages` 状态，所以没有 `completed` 可判。要止住它每次重写 `checkedAt`，判据应取**内容**（`documentSha256` + `rulesVersion` + 当前 review attempt 三者一致就复用既有报告），**绝不能为它伪造一个持久状态**——那等于在 manifest 里凭空造一个阶段。

**两条失效路径，语义不同，不可互相替代**：

| 路径 | 触发者 | 判据 | 实现 |
|---|---|---|---|
| 产物过期 | 上游输入变化 | 指纹不匹配 | 各阶段 run 内部自动调用 `invalidateStageAndDownstream` |
| **人工判定不合格** | 用户拒绝验收 / 显式指定起点重跑 | **无判据可推导**——输入一字未改 | 必须显式调用 `invalidateSlideStage` |

第二条路径靠指纹永远推不出来。缺了它，「拒绝并重跑」「从阶段 X 重跑」这类入口全部失效。

### 4. Validation & Error Matrix

| 条件 | 错误 |
|---|---|
| `reason` 为空或全空白 | `INVALID_STAGE_STATE`「阶段失效原因不能为空」 |
| 工作区缺少目标阶段状态 | `INVALID_WORKSPACE` |
| 目标阶段或下游为 `pending` | 不报错，保持 `pending`（无产物可作废） |

### 5. Good / Base / Bad Cases

- Good：`clean` 为 completed → `invalidateSlideStage(stage: "clean")` → `clean` 及已完成下游转 `stale`，上游 `mask` 保持 `completed`，随后 `run --from clean` 真正重新调用 API。
- Base：目标阶段本就是 `pending` → 返回空 `invalidated`，不写盘噪声。
- Bad：跳过失效直接 `run --from clean` → 守卫与 `isStageReusable` 双双放行复用 → 毫秒空转，用户反复点击无任何反馈。

### 6. Tests Required

- **断言必须落在 manifest 状态上，不能只断言函数返回值**。`slide-run-report.test.ts` 原有 5 个用例全部只检查 `report` 内容，无一碰 `manifest.stages`，这正是缺陷 6 能存活到端到端走查的原因。
- 失效后 `isStageReusable` 必须为 `false`（指纹不变，仅凭状态变化就要拒绝复用）；上游不被牵连；`pending` 不被改写成 `stale`；`reason` 为空报错。
- 重跑递增 attempt 编号而非覆盖。
- **幂等回归必须断言磁盘字节，不能断言「阶段还是 completed」**。后者在缺陷存在时也成立——`report` 重写完仍是 completed。正确的断言点是：全 completed 的工作区跑一遍编排后，`manifest.json` / `report.json` / `validation.json` 三个文件的内容逐字节不变。写完先**故意去掉守卫确认用例变红**，否则你不知道它测的是不是自己。
- 注意区分两条 `report` 路径：**显式调用** `slide report` 命令递增 attempt 是对的（既有用例锁着这条，别改坏）；**编排层**对已完成 report 的无条件重跑才是缺陷。同一个阶段，两种入口，语义不同。

### 7. Wrong vs Correct

#### Wrong

```ts
// 阶段收尾只写 assets —— 状态恒为 pending
await writeWorkspaceManifest(workspace.path, {
  ...manifest,
  updatedAt: report.generatedAt,
  assets: [...manifest.assets.filter((a) => a.id !== REPORT_ASSET_ID), asset],
});

// 拒绝验收后直接重跑 —— 阶段仍是 completed，被幂等跳过
startRun("clean");
```

#### Correct

```ts
await writeWorkspaceManifest(workspace.path, {
  ...manifest,
  updatedAt: report.generatedAt,
  assets: [...],
  stages: replaceStageState(manifest.stages, completedState),
  attempts: [...manifest.attempts, completedAttempt],
});

// 先失效再重跑；失效写盘失败则不启动 run，否则退化成空转
await invalidateSlideStage({ workspacePath, stage, reason: "人工要求从该阶段重跑" });
startRun(stage);
```

## 场景：人工闸门、瞬态阶段失效与双源比对（M4 复核链路简化，2026-07-27 走查验证；M5 起人工点由两个改为最多三个）

### 1. Scope / Trigger

- 触发条件：新增或修改人工闸门的停顿点与文案、验收记录的写入方式、复核分区判据、任何「失效某阶段」的界面入口，或桌面端任何需要与 PPTX 导出保持一致的换算。
- 适用范围：`packages/core/src/text-blocks.ts`、`pptx-text-style.ts`、`apps/cli/src/slide/accept-final.ts`、`apps/desktop/src/shared/stages.ts` 与 `shared/gates.ts`。
- 已由真实代码与端到端走查验证：链路由五个人工门收敛为两个；`validate-review` 的失效曾是静默空操作。
- **M5 更新（2026-07-31 走查验证）**：新增第三个闸门 `accept-source`，按来源条件性激活。改动人工闸门时 `apps/cli/src/slide/run-from.ts` 的 `RUN_SEQUENCE`、`shared/stages.ts` 的 `RUN_STAGE_SEQUENCE` / `STAGE_LABELS`、`shared/gates.ts` 的 `GATE_LABELS` 必须同批改——漏一处就退化成轨道缺节点或日志显示英文 id。

### 2. Signatures

```ts
// packages/core/src/text-blocks.ts
export function compareBlockSources(block: TextReviewBlock): BlockSourceTexts;
export interface BlockSourceTexts {
  readonly ocr: string | null;      // offline_ocr 来源文本
  readonly assist: string | null;   // ai_text_assist 来源文本
  readonly agrees: boolean;
}

// packages/core/src/pptx-text-style.ts —— CLI 合成与桌面端预览必须共用
export function fontSizePtFromPx(fontSizePx: number, imageWidth: number): number;
export function resolveFontSizePt(block: TextReviewBlock, imageWidth: number): number;
export function toBold(weight): boolean;
export function toAlign(align): "left" | "center" | "right";

// apps/cli/src/slide/accept-final.ts —— 一次人工动作写两条验收记录
export function runAcceptFinal(options: {
  readonly workspacePath: string;
  readonly acceptedBy?: string;
  readonly note?: string;
}): Promise<{ cleanAcceptanceId: string; pptxAcceptanceId: string; autoCheckSummary: string }>;

// apps/desktop/src/shared/stages.ts —— 失效前的阶段翻译，未知阶段抛错
export function resolveInvalidationTarget(stage: string): RunStage;
```

### 3. Contracts

**链路只有两个人工停顿点**（此前是五个）：

| 停顿点 | `gate` | 停在哪 | 恢复方式 |
|---|---|---|---|
| 源图确认（**按来源条件性激活**） | `source` | `init: completed` → `accept-source: pending` | `slide accept-source` / 界面确认 |
| 文本复核门 | `human-edit` | `assist-review: completed` → `mask: pending` | 复核完点「运行此页」 |
| 最终产物确认 | `manual` | `pptx: completed` → `accept-pptx: pending` | 「完成」写两条验收记录 |

**人工点数量口径（M5 D6 起）**：**最多三个**，其中源图确认只对 `generated` 页激活——`imported` / `extracted` 在建立工作区或换源时自动放行，仍是两个。判定由 core 的 `requiresSourceAcceptance` 单点定义，禁止在消费方各写一遍 `kind === "generated"`。

**闸门靠 core 兜底，不靠调用方自觉**：`ocr` 依赖 `accept-source`，`assertStageDependenciesCompleted` 因此对 CLI 与桌面端同时生效。但 `run --from` 必须在**循环外**先检查该闸门：只按序判定时 `run --from ocr` 会绕过它、改由依赖守卫抛错，把「等一个人来确认」误报成「阶段 ocr 无法自动执行」。

`accept-clean` **不再单独停顿**，滑块对比降级为最终确认页内的一档视图。闸门中文文案由 `apps/desktop/src/shared/gates.ts` 单点定义——main 的活动日志与 renderer 的即时记录都从这里取，否则同一条事件在刷新前后会出现两种说法。

**`accept-final` 写入契约**：两条记录结构与单步验收完全一致，note 统一前缀 `经最终产物确认统一验收`（用户备注以冒号接在其后，无备注时不留尾随冒号）；**`checklist` 必须为空对象**。单步验收的 `DEFAULT_CHECKLIST` 是一组恒 true 的默认值，照抄会在 manifest 里留下与自动检查矛盾的假人工记录（走查实测：写出的 `sizeCorrect: true` 与同页 `size.ok: false` 直接打架）。已 completed 的验收阶段复用既有 attempt，不追加；clean 成功而 pptx 失败时不回滚，重试只补 pptx 侧。

**验收不自动跑 `report`**：`STAGE_DEPENDENCIES` 把 report 排在 accept-pptx 之后，验收只写两条 accept 记录，report 由用户点「运行此页」或批量续跑补上。

**瞬态阶段的失效必须先翻译**：`RUN_STAGE_SEQUENCE`（执行序列，含 `validate-review`）与 core 的 `SlideStage`（manifest 持久化，不含）是两个集合。用瞬态阶段名调 `invalidateStageAndDownstream` 匹配不到任何 `WorkspaceStageState`，**静默返回空数组**。所有失效入口必须先过 `resolveInvalidationTarget`（`validate-review → mask`），未知阶段或无替身的瞬态阶段一律抛错。

**双源比对判据**：`compareBlockSources` 是分区、diff 展示、测试的**唯一口径**，任何消费方不得自行实现。去除所有空白字符后逐字相等即 `agrees`；**任一来源缺失时 `agrees: false`**——无从比对不等于已确认一致。

**换算公式同源**：桌面端合成预览的字号、粗细、对齐必须调用 `pptx-text-style.ts` 的同一组函数，不得在 renderer 侧重算。预览容器固定 16:9 并让底板拉伸填满：PPTX 把 clean plate 满铺到 13.333×7.5 英寸版面，而真实底板是 1672×941，不强制 16:9 会让块的百分比定位与 PPT 版面对不上。

**`layout_text` 与 `includeInMask` 双向绑定**：`buildFreshBlock` 对 `layout_text` 默认 `includeInMask = true`；校验两条互为反向的 error 规则见下表。因此界面上切换分类必须同步改 `includeInMask`，只改一边必然触发校验失败。

### 4. Validation & Error Matrix

| 条件 | 行为/错误 |
|---|---|
| `classification === "layout_text"` 且 `!includeInMask` | `LAYOUT_TEXT_MUST_BE_MASKED`（error）——文字既留在底板位图又生成文本框，导出即重影 |
| `includeInMask` 且 `classification !== "layout_text"` | `MASK_REQUIRES_LAYOUT_TEXT`（error） |
| `resolveInvalidationTarget` 收到未知阶段名 | 抛 `无法失效未知阶段：<stage>` |
| `resolveInvalidationTarget` 收到无替身的瞬态阶段 | 抛 `瞬态阶段 <stage> 缺少失效替身，无法失效` |
| 双源任一缺失 | `agrees: false`，归入「文字待确认」而非「已一致」 |
| 编辑后文本为空串 | 必须移除该块的 `manual` 来源条目——`TextBlockSourceSchema.text` 是 `min(1)`，留空串会被 zod 拒绝写盘 |

### 5. Good / Base / Bad Cases

- Good：全新 deck 批量处理停在 `human-edit`，活动日志写「停在文本复核门：有 N 个版式目标文字待人工复核」；复核完继续跑，一路到 pptx 停最终确认；「完成」后两条 accept 记录齐备且 checklist 为空。
- Base：既有工作区（`schemaVersion`/`workspaceVersion` 均为 1）无需迁移即可打开并 `--strict` 导出。
- Bad：文本复核门以「mask 阶段执行失败」的形式表现（旧代偿行为，会诱导用户去点「全部标为已复核」）；桌面端自行实现 diff 或字号换算；失效入口不经翻译直接把界面阶段名传给 IPC。

### 6. Tests Required

- `LAYOUT_TEXT_MUST_BE_MASKED` 命中与不命中各一例；`buildFreshBlock` 三种分类的 `includeInMask` 默认值。
- `compareBlockSources` 覆盖一致 / 分歧 / 缺一个来源三种情形；分区计数用真实快照夹具断言（夹具须进仓并排除格式化，任务目录归档后路径会失效）。
- **「执行序列里每个阶段都能解析出失效目标」**——今后新增瞬态阶段而忘配替身会直接失败。
- `accept-final` 断言 checklist 为空、note 前缀正确、无备注时无尾随冒号。

### 7. Wrong vs Correct

#### Wrong

```ts
// 界面阶段名直接下发 —— validate-review 匹配不到持久阶段，静默失效 0 个
await invalidateSlideStage({ workspacePath, stage, reason });

// 桌面端自己算字号 —— 与 CLI 导出口径漂移
const fontSizePx = block.style.fontSizePx ?? block.bboxPx.height * 0.65;
```

#### Correct

```ts
// main 的 IPC 边界统一翻译，未知阶段抛错而非静默放过
const target = resolveInvalidationTarget(stage);
await invalidateSlideStage({ workspacePath, stage: target, reason });

// 预览与导出共用 core 的同一份公式
const fontSizePx = resolveFontSizePt(block, imageWidth) * ptToPx;
```

## 场景：多代资产与「当前产物」选取契约（M5 换源路径，2026-08-01 真实 deck 走查验证）

### 1. Scope / Trigger

换源与阶段重跑都会让**同一个 `role` 在 `assets` 里出现多条**，分属不同世代。消费方若按裸 `role` 取首条，拿到的是上一代——文件确实存在、哈希也对，错的是它描述的对象已经不是当前那个。`assertWorkspaceAssetIntegrity` 查不出这类错误。

本轮四个缺陷有三个源于此，全部在真实 deck（`ppttest-2026-07-25` 副本，两页十阶段跑完）上实证：

| 消费点 | 取到的 | 表现 |
|---|---|---|
| `mask/run.ts` 的 `review_validation` | 归档件（排在当前之前） | 拿旧复核稿的 `documentSha256` 比对，误报「text-blocks.json 在校验后已改动」，**换过源的页一个都跑不过 mask** |
| `report/run.ts` 的 `ocr_result` | 上一轮 OCR | 发现数报的是旧值 |
| `replace-source.ts` 漏归档 `source_acceptance` | —— | 对**上一张图**的人工确认留在固定路径，自动放行的页磁盘上有 `accepted.json`，「文件在不在」这个判据被打穿 |

### 2. Signatures

```ts
// 当前源图：显式指针，不按 role 找
manifest.sourceImageAssetId: string
currentSourceImageAsset(manifest): WorkspaceAsset | undefined   // desktop main/slide-detail.ts

// 当前校验报告：按固定当前路径判定
findCurrentValidationAsset(manifest): WorkspaceAsset | undefined // cli mask/run.ts

// 当前阶段产物：按该阶段最后一次成功 attempt
currentSuccessAsset(manifest, stage, role): WorkspaceAsset | undefined // cli report/run.ts
                                                                       // 与 desktop main/slide-detail.ts 同源

// 换源归档：目标以 {role, path, renameId} 描述，path 是判据而非 role
archiveArtifacts(workspacePath, assets, initAttemptId, targets)  // cli slide/replace-source.ts
```

### 3. Contracts

**归档形状**：`<dirname>/archived/<initAttemptId>/<basename>`，复核件与验收记录同形。归档而非删除——资产记录必须始终指向真实存在的文件，且人工劳动留痕可追溯。

**换源的归档目标**（`replace-source.ts`）：

| role | 固定当前路径 | 归档时换 id | 受 `--keep-review` 影响 |
|---|---|---|---|
| `text_review` | `stages/review/text-blocks.json` | 否（id 已按 review attempt 唯一） | 是 |
| `review_validation` | `stages/review/validation.json` | 是（`-archived-<initAttemptId>`，固定 id 会被下次 validate 覆盖） | 是 |
| `source_acceptance` | `stages/source/accepted.json` | 是（同上） | **否，无条件归档** |

`source_acceptance` 不受 `--keep-review` 影响：那个开关保的是文字复核的人工劳动（对新图仍有参考价值、走 IoU 对齐），而「上一张图我看过了，能用」对新图根本不成立。

**「当前」的判据按 role 分三类**：

| 判据 | 适用 | 例 |
|---|---|---|
| 显式指针 | `source_image` | `sourceImageAssetId` |
| 固定当前路径 | 有唯一固定落点的产物 | `review_validation` |
| 阶段最后一次成功 attempt | 每次 attempt 各出一份的产物 | `ocr_result`、`text_review`、`clean_plate` |

**`role` 表达「这是什么」，不得用来编码「是不是当前的」。** 归档件在语义上仍是一份 `review_validation`，真正区分它的是「不是当前那份」——所以判据落在路径/指针/attempt，而不是给归档件换一个 role（那要动 `SlideAssetRoleSchema` 与父任务 §5 的 role 表，波及未落地的子任务）。

### 4. Validation & Error Matrix

| 条件 | 要求 |
|---|---|
| 消费当前产物 | 禁止 `assets.find(a => a.role === X)`；必须附带指针、路径或 attemptId 判据 |
| 换源产生新一代 | 上一代的固定路径产物必须移走，固定路径上不得残留 |
| 换源后来源重判为自动放行 | 固定路径上**不得**存在 `accepted.json`（判据即「文件在不在」） |
| 归档多条资产指向同一文件 | 同一源路径只搬一次，所有引用它的记录一并改指 |
| 归档或写盘中途失败 | 回滚已搬文件与已写 config，不得留下 manifest 与磁盘分叉的半完成态 |

### 5. Good / Base / Bad Cases

- **Good**：换过源的页跑完 mask → clean → pptx → `export --strict`，归档件与当前件各就各位
- **Base**：从未换过源的页，每个 role 仅一条，裸 `find` 恰好也对——**这正是危险所在，测试必须避开这种形态**
- **Bad**：`assets.find(a => a.role === "review_validation")` 在换源后取到 `archived/init-002/validation.json`，报出一个磁盘上根本不存在的不一致

### 6. Tests Required

- 构造**归档件排在当前件之前**的资产形态，并加前置断言（该 role 恰好 2 条、第 0 条是归档路径、第 1 条是当前路径）——否则用例可能什么都没覆盖
- 换源后 `accept-source` 自动放行时，固定路径无 `accepted.json`；换成 `generated` 时同样无
- 归档中途失败（把归档目标占成目录触发 `EISDIR`）后磁盘无残留、manifest 逐字节未变
- **验收必须跑到操作之后的下游**：只跑到「换源成功」为止会漏掉「换源之后链路断了」。本轮 B6/B7 判过一次仍漏了 mask 这一关，就是因为自动化测试止于换源。涉及换源这类产生新一代产物的操作，验收形状必须是**跑完完整链路 → 执行该操作 → 继续跑下游到底**
- fixture 必须复刻真实 deck 的资产形态：真实页跑完链路后 `review` 与 `assist-review` 各写过一次复核稿，`text_review` 有**两条指向同一路径**；只造一条的 fixture 会让缺陷全程隐身

### 7. Wrong vs Correct

#### Wrong

```ts
// 按裸 role 取首条 —— 换源后取到归档件，且 assertWorkspaceAssetIntegrity 查不出来
const validationAsset = manifest.assets.find(
  (asset) => asset.role === "review_validation",
);

// 归档时逐条 rename —— 多条资产指向同一文件，第二条必 ENOENT
for (const asset of matched) {
  await rename(resolve(asset.path), resolve(archivedPath));
}
```

#### Correct

```ts
// 判据能区分「当前」与「归档」
const validationAsset = manifest.assets.find(
  (asset) =>
    asset.role === "review_validation" && asset.path === VALIDATION_OUTPUT_PATH,
);

// 同一源路径只搬一次，所有引用一并改指
let archivedPath = archivedPaths.get(asset.path);
if (archivedPath === undefined) {
  archivedPath = `${dirname(asset.path)}/archived/${initAttemptId}/${basename(asset.path)}`;
  await rename(from, to);
  archivedPaths.set(asset.path, archivedPath);
}
```

---

## 场景：原生二进制的契约边界与系统 API 的单向自适应（M5 PDF 抽取，2026-08-01 实证）

### 1. Scope / Trigger

新增或修改 `native/*` 下的原生二进制，或消费系统绘图 / 渲染 API 的「自适应」变换时适用。

两条独立的教训，都在 `native/macos-pdf-render` 落地时实证：

1. **系统 API 的「自适应」可能只单向生效**。`CGPDFPage.getDrawingTransform(_:rect:rotate:preserveAspectRatio:)` 只把页面**缩小**以塞进目标矩形，**从不放大**。直接喂 2048×1152 的矩形，一页 960×540 的 PDF 会以 1:1 居中绘制、四周大片留白——**不报错、不返回失败、图也确实产出了**，只是内容小了一圈。这是典型的静默降级（见 [silent-failure-thinking-guide](../guides/silent-failure-thinking-guide.md)）。
2. **业务判定不得下沉进原生二进制**。二进制只做「系统 API 能做而 TS 做不了的事」，判定留在 TS 侧用 core 的单点定义。否则同一个容差会有 TS 与 Swift 两份实现，改一处忘一处。

### 2. Signatures

```
macos-pdf-render probe  <pdf>
  → { rendererId, rendererVersion, documentPageCount, encrypted,
      pages: [{ pageNumber, widthPt, heightPt, hasExtractableText }] }

macos-pdf-render render <pdf> <outDir> <targetWidth> [--pages 1,2,5]
  → { pages: [{ pageNumber, path, width, height, renderDpi }] }
```

**拆成两个子命令是契约设计的一部分**，不是为了省事：`probe` 不渲染，TS 侧拿 `widthPt/heightPt` 判完 16:9 再让它只渲染合格页。收益是二进制里零业务逻辑 + 不渲染注定要跳过的页；代价是两次进程启动。

### 3. Contracts

**几何取值**：用 `CGPDFPage.getBoxRect(.mediaBox)` + `rotationAngle`，`/Rotate` 为 90 或 270 时**必须交换宽高**。不用 `PDFPage.bounds(for:)`——它是否算入页面旋转在文档上并不明确，而 CGPDFPage 这两个值是无歧义的原始值。漏掉旋转会让横放的竖版页被误判成 16:9。

**加密判据用 `isLocked` 而非 `isEncrypted`**：只设了权限口令的 PDF 会被 PDFKit 自动解锁、可以正常渲染，按 `isEncrypted` 拒绝它是错的。

**版本标识**：`rendererId` 是稳定常量（`"macos-pdfkit"`），`rendererVersion` = 二进制自身版本常量 + 运行时系统版本（`ProcessInfo.operatingSystemVersion`）。系统框架多半没有独立版本号，宿主系统版本是唯一可复现锚点——而 `ExtractedSource` 存这两个字段就是为了「同一页可复现」。

**TS 侧不信任二进制自报的像素尺寸**：资产的 `image.width/height` 一律由建页路径实测磁盘文件填充。与生成路径的 RK1 衍生约束同源——渲染器报的尺寸与磁盘文件不符时，实测才是真的。

**契约切在二进制边界上**，因此换渲染后端（如 `pdftoppm`）时 TS 侧零改动。**渲染保真度出问题时不要改 TS 侧去将就**，换后端才是回滚路径。

### 4. Validation & Error Matrix

| 条件 | 要求 |
|---|---|
| 目标尺寸大于页面原始尺寸 | 必须自行 `scaleBy`，不得依赖 `getDrawingTransform` 放大 |
| 页面 `/Rotate` 为 90 / 270 | 交换 `widthPt` / `heightPt` 后再参与比例判定 |
| 文档 `isLocked` | 以既有错误码体系报错退出，不做交互解锁 |
| 二进制不存在 | 报「请先运行 `pnpm build:<name>`」，不得是裸 ENOENT |
| 需要业务判定（容差、阈值、格式白名单） | 留在 TS 侧调 core 的单点定义，二进制不得自行判定 |
| 消费二进制自报的尺寸 | 禁止直接写入资产元数据，必须实测磁盘文件 |

### 5. Good / Base / Bad Cases

- **Good**：小尺寸矢量页（960×540）放大到目标宽度 2048，内容铺满画布无留白
- **Base**：页面原始尺寸恰好 ≥ 目标宽度——此时 `getDrawingTransform` 的缩小路径生效，**看起来一切正常，缺陷完全隐身**。只用大尺寸样张测就永远发现不了
- **Bad**：直接把目标矩形喂给 `getDrawingTransform`，小页 1:1 居中绘制，产出图四周大片白边，命令退出码 0、报告一切正常

### 6. Tests Required

- 合成 fixture 必须**同时含小于和大于目标宽度的页**——只有小页能暴露单向自适应
- 断言产出 PNG 的实际像素等于目标宽度，且**内容非空白**（纯尺寸断言过不了这一关：留白的图尺寸也是对的）
- `/Rotate 90` 的页参与比例判定时用交换后的宽高
- 只设权限口令的 PDF 能正常抽取，不被 `isEncrypted` 误拒
- 资产尺寸断言必须对**磁盘实测值**，不接受「等于请求的目标宽度」

### 7. Wrong vs Correct

#### Wrong

```swift
// 指望 getDrawingTransform 把页面缩放到目标矩形 —— 它只缩不放，
// 小页会 1:1 居中绘制，四周留白，且不报任何错
let target = CGRect(x: 0, y: 0, width: 2048, height: 1152)
context.concatenate(
    ref.getDrawingTransform(.mediaBox, rect: target, rotate: 0, preserveAspectRatio: true)
)
context.drawPDFPage(ref)
```

#### Correct

```swift
// 放大自己算，只让 getDrawingTransform 按页面点尺寸处理旋转与原点平移
let scale = CGFloat(Double(pixelWidth) / size.widthPt)
let pageRect = CGRect(x: 0, y: 0,
                      width: CGFloat(size.widthPt), height: CGFloat(size.heightPt))
context.scaleBy(x: scale, y: scale)
context.concatenate(
    ref.getDrawingTransform(.mediaBox, rect: pageRect, rotate: 0, preserveAspectRatio: true)
)
context.drawPDFPage(ref)
```

---

## 场景：独立可寻址契约文件的版本轴（M5 内容规格定稿，2026-08-01）

### 1. Scope / Trigger

新增一个**独立可寻址的契约文件**（不是宿主 manifest 的属性，而是自己一个文件、被别的里程碑或别的层读写）时适用。例：`<deck>/content-spec.json`。

判据：这份数据会不会**脱离宿主单独演进**？会，就需要自己的版本轴。

### 2. Signatures

```ts
// 宿主 manifest 的版本 —— 描述工作区 / deck 自身的 schema 世代
export const SCHEMA_VERSION = 1 as const;   // packages/core/src/constants.ts

// 独立契约文件的版本 —— 应当独立演进
ContentSpecSchema.shape.schemaVersion       // packages/core/src/content-spec-contracts.ts
```

### 3. Contracts

**属性 vs 文件，版本策略不同**：

| 形态 | 例 | 版本 |
|---|---|---|
| 宿主 manifest 的一个属性 | `SlideSource` | **不带**自己的版本号，随宿主走 |
| 独立可寻址文件 | `content-spec.json` | **应当带**自己的版本号，独立演进 |

`SlideSource` 刻意不带版本号与本条不矛盾：它随宿主的 `schemaVersion` 一起被校验，宿主升版时它自然跟着走。独立文件没有这个宿主。

**现状与已知张力（M5 遗留，M6 已定处置）**：`ContentSpec.schemaVersion` 实现取的是 `z.literal(SCHEMA_VERSION)`，即与宿主同源。后果是**宿主因自身原因升 `SCHEMA_VERSION` 时，全部既有 `content-spec.json` 会一并校验失败**——而它们的内容一个字节都没变。

**「独立演进」是意图，不是现状**：本节 §7 的 Correct 写法是目标形态，`content-spec.json` 今天并没有落到那里。任何读到「M6 极可能扩展它，需要自己的版本轴」这类表述的人，不要据此认为解绑已经完成——`SCHEMA_VERSION` 是全仓共用常量（`packages/core/src/constants.ts`），manifest / stage-graph / workspace / pptx / clean / content-spec 全写成 `z.literal(SCHEMA_VERSION)`，升到 2 就是一次**全仓迁移**，与 M3/M4 已对使用者作出的零迁移承诺直接冲突。

**M6 的处置（2026-08-02，决策 D2）**：不解绑、不升版本、不扩本契约。`style` 因此维持 `description: string` 不拆结构化子字段——拆了就得升版本或加可选字段，前者触发全仓迁移，后者要在指纹里做条件包含、破坏「显式列字段」纪律。M6 新增的旁路文件（`<deck>/planning/` 下的变更日志与会话记录）**自带局部 `v: 1`，不挂全仓版本轴**：它们是旁路数据，坏行跳过即可，不需要全局版本世代。

真正解绑（另起 `CONTENT_SPEC_VERSION`）是一次独立评估，触发条件是「确实要改内容规格的形状」，M6 没有触发它。

### 4. Validation & Error Matrix

| 条件 | 要求 |
|---|---|
| 新增独立可寻址契约文件 | 显式决定版本轴归属，并在 schema 注释里写明理由 |
| 契约文件将被另一里程碑 / 另一层读写 | 版本号必须独立于宿主 `SCHEMA_VERSION` |
| 宿主升 `SCHEMA_VERSION` | 逐个检查绑在它上面的独立文件，确认「这些文件真的也变了」 |
| 契约字段新增 | 显式决定是否进指纹口径（见下） |

**关联约束——指纹口径必须显式列字段**：跨里程碑契约的指纹不做通用 canonical JSON，而是按 schema 显式列字段喂给 `sha256Values`，并带前缀标签（`group:` / `item:`）防止不同结构拼出同一串。显式列举顺带保证「新增字段必须显式决定是否进指纹」，不会因为加了个字段就静默改变所有历史数据的漂移判断。

### 5. Good / Base / Bad Cases

- **Good**：宿主 `SCHEMA_VERSION` 从 1 升到 2，既有 `content-spec.json` 照常可读
- **Base**：宿主版本号从未变过——**两种策略此时行为完全一致，差异不可见**
- **Bad**：宿主为了 manifest 的一处改动升到 2，用户手里所有内容规格文件同时报「schemaVersion 不匹配」，而这些文件与那处改动毫无关系

### 6. Tests Required

- 用例断言的是**字面版本值**（`schemaVersion: 1`），不要写成引用宿主常量——否则宿主升版时用例跟着变，正好掩盖了这个缺陷
- 指纹用例覆盖：改一条条目只有该条目指纹变、改 deck 级字段全部条目指纹变、**JSON 键顺序重排不改变指纹**、不同结构不碰撞

### 7. Wrong vs Correct

#### Wrong

```ts
// 独立可寻址的契约文件，版本绑死在宿主上
// —— 这**就是今天 content-spec.json 的实现**，不是假想例
export const ContentSpecSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),   // 宿主升版 → 既有规格文件全部失效
  ...
});
```

#### Correct

```ts
// 自己的版本轴，与宿主解耦
export const CONTENT_SPEC_VERSION = 1 as const;
export const ContentSpecSchema = z.object({
  schemaVersion: z.literal(CONTENT_SPEC_VERSION),
  ...
});
```

## 场景：来源规则派生状态——重判点与消费端（M5 阶段三集成走查验证，2026-08-02）

### 1. Scope / Trigger

- 触发条件：新增或修改任何**由规则单点推导、而非由人操作产生**的状态；给这类状态新增写入路径；或在报告 / 界面上呈现「这个状态是怎么来的」。
- 本项目的实例是 `accept-source`：它的初始值由 `requiresSourceAcceptance(source)` 单点决定——`generated` 为 `pending`，`imported` / `extracted` 直接 `completed`。**来源决定的是「源图是否已被信任」这一个布尔量，不是「走哪条链路」**（design.md §4.5）。
- 已由真实走查验证的两个缺陷，同源、方向相反：
  - **写入侧漏判**：`invalidateSlideStage` 把非生成页的 `accept-source` 打成 `stale` 后没有重新判定，该页成为**死路**；
  - **读出侧零消费**：磁盘上「人工确认 vs 自动放行」区分得干干净净，但没有任何报告或界面读得到，A10「报告能区分」因此不成立。

### 2. Signatures

```ts
// packages/core/src/source-contracts.ts —— 唯一判据，别在别处复刻
export function requiresSourceAcceptance(source: SlideSource): boolean;

// packages/core/src/source-acceptance.ts —— 判据的读出侧，三个消费端共用
export type SourceAcceptanceKind = "manual" | "auto" | "pending";
export function classifySourceAcceptance(manifest: SlideWorkspaceManifest): SourceAcceptanceKind;

// apps/cli/src/slide/workspace.ts
export const AUTO_SOURCE_TRUST_PROVIDER = "auto-source-trust";
```

### 3. Contracts

**规则派生的状态，在每一条会改动它的路径上都必须重新判定。** 目前有两条：

| 路径 | 实现 | 重判方式 |
|---|---|---|
| 换源 | `replaceSlideSource` 第 5 步 | 先失效 `accept-source`，再按**新来源**用 `buildSourceGate` 重判 |
| 显式失效 | `invalidateSlideStage` | 失效算完后，若闸门非 `completed` 且该页来源无需人工确认，用**同一个** `buildSourceGate` 重新放行；**下游保持 `stale`** |

第二条长期缺失。后果不只是「界面摆了个按下去必然失败的按钮」——`run --from` 给出的下一条命令 `ppt-maker slide accept-source` **就是那条会被 `runAcceptSource` 按来源拒绝的命令**，CLI 与界面双双死路，除手改 manifest 无出路。

**修在失效点，不要去堵按钮。** `runAcceptSource` 拒绝非生成页是对的——放开它就会写出一条 `acceptedBy` 指向某人的记录，正是 design.md §4.5 明令禁止的伪造人工痕迹；界面读的 `awaitingSourceConfirm` 也是忠实的。**错的是那个状态本身不该存在**。凡是「界面给出了一个必然失败的入口」，先怀疑状态机让页面进入了一个不该存在的状态，而不是急着让入口消失。

**自动放行与人工确认必须同时满足三条**：

| | 人工确认 | 按来源自动放行 |
|---|---|---|
| `stages[accept-source].status` | `completed` | `completed` |
| attempt 的 `provider` | 真实操作者（如 `developer`） | `auto-source-trust` |
| attempt 的 `assetIds` | `["asset-source-acceptance"]` | `[]` |
| 磁盘 `stages/source/accepted.json` | **存在** | **不存在** |

**落盘区分了，不等于报告能区分。** `AUTO_SOURCE_TRUST_PROVIDER` 曾在全仓只有产生端、零消费端——`deck status`（结构化与人读）、桌面端 IPC 与界面、`slide report` 的 `report.json` 三处都读不到它，于是「人工确认 vs 自动放行」只能靠**缺席**反推（「人工接受段里没有源图，所以大概是自动的」）。**一个只写不读的标记，等于没写。** 凡是为了「将来能区分」而落盘的字段，落盘的同时就要指出它的消费端在哪；指不出来，这个字段就还没做完。

**判据取磁盘事实，不要用来源类型反推。** 有一格是要害：`normalizeSlideManifest` 给旧 manifest 补出来的 `accept-source` 沿用 `init` 的 attempt（`provider` 是 `ppt-maker-cli`）。若把判据写成「provider 不是 `auto-source-trust` 就算人工确认」，**M3/M4 时代的每一页都会凭空长出人工痕迹**——零迁移的旧工作区反而成了受害最重的那个。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| 非生成页调用 `runAcceptSource` | `INVALID_STAGE_STATE`「来源 X 的源图无需人工确认，已在建立工作区时自动放行」——**保持拒绝，别放开** |
| 非生成页的 `accept-source` 被显式失效 | 不报错；失效算完后自动重放行，追加 `auto-source-trust` attempt，**不写** `accepted.json`，下游保持 `stale` |
| 生成页的 `accept-source` 被显式失效 | 保持 `stale`，`runAcceptSource` 仍可用，再次确认写 `accept-source-002` |
| 显式失效 `init` | **不重放行**——此时源图本身存疑，放行会与 `assertStageDependenciesCompleted` 打架；且 `init` 不在 `RUN_SEQUENCE` 里，无重跑路径 |

### 5. Good / Base / Bad Cases

- Good：`extracted` 页 10/10 全完成 → 失效 `accept-source` → `invalidated` 列出下游 9 个**不含** `accept-source`；闸门回 `completed`、`blockingStage` 由 `accept-source` 变为 `ocr`；新增 attempt 为 `auto-source-trust` 且 `assetIds` 为 `[]`。
- Base：旧格式 manifest（无 `source`、无 `accept-source`）归一化后判为 `auto`，**且读操作不改写磁盘一个字节**。
- Bad：把 `accept-source` 打成 `stale` 就收工 → 该页 CLI 与界面双双死路；或为了「让按钮能用」放开 `runAcceptSource` → 凭空产生假的人工验收记录。

### 6. Tests Required

- **`manual` ⟺ 磁盘存在 `stages/source/accepted.json`**，逐页对表，一处不符即缺陷复发。这是唯一不会被来源类型反推蒙混过去的断言。
- 归一化出来的闸门必须判为 `auto`——用一份真实的旧 manifest（无 `source` 字段）上锁，不要用手造的。
- 非生成页失效后：闸门回 `completed`、下游全 `stale`、`invalidated` 不含闸门本身、磁盘无 `accepted.json`。
- 生成页失效后行为不变（这条是防止修复越界的负面用例）。

### 7. Wrong vs Correct

#### Wrong

```ts
// 写入侧：失效完就收工，规则派生的状态被留在一个规则不承认的值上
const invalidated = invalidateStageAndDownstream(stages, stage, reason);
return { invalidated };

// 读出侧：标记只写不读，报告靠「缺席」反推
attempts.push({ stage: "accept-source", provider: AUTO_SOURCE_TRUST_PROVIDER, assetIds: [] });
// …全仓再无一处读 AUTO_SOURCE_TRUST_PROVIDER

// 判据侧：拿来源类型反推，旧工作区每页凭空长出人工痕迹
const isManual = source.kind === "generated";
```

#### Correct

```ts
// 写入侧：失效算完后按来源重判，与换源路径复用同一个 buildSourceGate
const invalidated = invalidateStageAndDownstream(stages, stage, reason);
const gate = buildSourceGate(manifest.source);   // 下游保持 stale，只重放行闸门本身
return { invalidated: invalidated.filter((s) => s !== "accept-source") };

// 读出侧：判据下沉到 core，三个消费端（status / report / IPC）共用一份
export function classifySourceAcceptance(m: SlideWorkspaceManifest): SourceAcceptanceKind;

// 判据侧：取磁盘事实——attempt 的 provider + 有无 ArtifactAcceptance
const isManual = acceptanceAssetExists && attempt.provider !== AUTO_SOURCE_TRUST_PROVIDER;
```

---

## 场景：模型可提案、不可直接落盘（M6 D5 对 M5 D7 的放宽，2026-08-02）

> **状态：底座已落地（M6 子任务①，2026-08-03），模型面尚未接入。** 三道闸中的 ③（代码写盘、
> 统一入口、id 由代码分配）已由 `applySpecChange` 实现并测试覆盖，「确认前预告影响面」也已由
> `previewSpecChange` 提供；① 逐字段 diff 展示与 ② 用户确认属界面，由子任务②③ 落地。
> 具体契约见下一节〈规格写入唯一入口与变更日志〉。本节先行收录的原因不变：M5 父任务
> `prd.md:44` 的 D7 原文写着「**不引入模型改写**」，不写这条，后来者会照原文判定 M6 违规。

### 1. Scope / Trigger

让模型输出**会落到磁盘契约文件里**的结构化内容时适用。

本项目实例是 M6 的对话式改稿：用户说「第三页文字太多」，模型返回**替换后的完整规格条目**，
落盘目标是 `<deck>/content-spec.json` —— 一份被 M5 生成链路原样消费的跨里程碑契约。

不适用于纯展示型的模型输出（只给用户看、不进任何契约文件）。

### 2. Signatures

```ts
// M5 D7 原文（.trellis/tasks/archive/2026-08/07-31-page-sources-and-content-generation/prd.md:44）
// 「调整主路径是『重生成时附带一句说明』并回写规格条目，不引入模型改写」

// M6 D5 放宽后的口径
//   模型可提案，不可直接落盘。
```

### 3. Contracts

**放宽后仍然成立的三条**（D7 保护的实质，一条都不能松）：

1. **规格不被静默改写**——任何变更都由用户的确认动作触发；
2. **`specEntryId` / `specId` / 时间戳始终由代码分配**，模型不得编造，模型给出的一律丢弃重分配；
3. **规格改动只产生只读漂移标注**，不自动失效任何阶段（M5 A13 不变）。

**不再成立的一条**：「不引入模型改写」这句字面表述本身。

**提案到落盘之间的三道闸**，一道都不能省：

| 闸 | 内容 |
|---|---|
| ① 逐字段 diff | 界面展示改前改后，不是「模型说改好了」 |
| ② 用户显式确认 | 确认前**不写**契约文件 |
| ③ 代码写盘 | 分配 / 保留 id 与时间戳，再走**统一写入入口** |

**提案 ≠ 变更**：被否决的提案照样写会话记录（过程留痕），但契约文件只反映被接受的结果。
这两处落点不同是刻意的——把「模型说过什么」和「磁盘上是什么」分开，才能事后区分
「模型提错了但被拦下」与「模型提错了并且落盘了」。

**确认前必须预告影响面**：用既有指纹口径预先算出提案落盘后的新指纹，与各页已记录的
指纹比对，在确认对话框里写明「确认后 N 页变为已过时」。这是选择「输出全量条目」
而非「输出 patch」的直接收益——patch 语义算不出落盘后的指纹，只能落完再看。

**写入路径必须唯一**：契约文件的任何写入走单一入口，禁止调用方直接调底层写函数。
变更日志靠写入路径捎带落盘，留第二条路径日志就会漏记，而漏记的表现是「历史里没有这次改动」
——一种事后无法察觉、也无法补救的静默损坏。

### 4. Validation & Error Matrix

| 条件 | 要求 |
|---|---|
| 模型面 schema | **一律无约束**（不带 `min` / `refine`）。Structured Outputs 的 JSON Schema 不接受它们，带约束直接喂 `zodTextFormat` 会被 API 拒绝（既有教训见 `content-spec-contracts.ts` 的 `zodTextFormat` 注释） |
| 落盘前 | 必经完整契约 schema 的 `parse` 补齐全部约束——约束一条不少，只是校验位置从模型侧挪到写入侧 |
| 模型 refusal / 解析为空 | `safeParse` 失败即放弃本轮，**不得**把自由文本当作契约内容 |
| 模型返回了 id | 丢弃重分配，不信任 |
| 会触发付费生成的确认 | 文案写明调用次数与不可撤销 |
| 模型调用的 `requestId` | 网关不回传 `x-request-id` 时**如实记 `null`**，不伪造、不用其它 id 填充 |
| 旁路日志写失败 | 只记 stderr，**不上抛**、不回滚已完成的契约写入（照搬 `activity-log.ts` 的纪律） |

### 5. Good / Base / Bad Cases

- **Good**：模型提出改三条条目 → 界面逐字段 diff 并预告「确认后 3 页变为已过时」→
  用户取消其中一条 → 剩两条经统一入口落盘并记一条变更记录
- **Base**：模型本轮只回答问题、不提改动 → 只写会话记录，契约文件零改动
- **Bad**：模型返回的条目直接 `parse` 成功就写盘，用户事后从漂移标注里才发现被改了什么

### 6. Tests Required

- 提案被否决后，契约文件字节不变、会话记录里能查到这条被否决的提案
- 模型返回自造 id 时，落盘后的 id 是代码分配的那个
- 模型 refusal / 输出无法解析时，契约文件不被触碰
- 删除全部旁路文件后，主链路（生成 / 复核 / 导出）行为不变

### 7. Wrong vs Correct

#### Wrong

```ts
// 模型输出解析成功就落盘，用户只在事后看到结果
const proposal = SpecProposalSchema.parse(await callModel(userText));
await writeDeckContentSpec(deckDir, proposal);   // 静默改写 + 绕过统一入口 + 漏记日志
```

#### Correct

```ts
// 模型只产出提案；提案先留痕，确认后才由代码写盘
const parsed = SpecProposalSchema.safeParse(await callModel(userText));
if (!parsed.success) return { kind: "rejected" };      // 不把自由文本当契约
await appendPlanningMessage(deckDir, { role: "assistant", proposal: parsed.data });

const preview = previewOutdatedPages(currentSpec, parsed.data);   // 确认前预告影响面
if (!(await confirmWithUser(preview))) return { kind: "declined" };

await applySpecChange(deckDir, {                       // 唯一写入入口，捎带记日志
  next: materialize(parsed.data, { ids: allocateIds() }),   // id 由代码分配
  origin: "proposal",
});
```

---

## 场景：规格写入唯一入口与变更日志（M6 子任务①，2026-08-03 由真实 deck 走查验证）

### 1. Scope / Trigger

修改 `<deck>/content-spec.json` 时适用——无论改动来自人工编辑、CLI 命令、模型提案还是回滚。

也适用于任何「契约文件 + 旁路变更日志」的组合：日志靠写入路径**捎带**落盘时，
写入路径的唯一性就是日志完整性的**全部**保障。

### 2. Signatures

```ts
// apps/cli/src/deck/spec-edit.ts —— 唯一写入入口
applySpecChange(options: {
  deckPath: string; nextSpec: ContentSpec; origin: "manual" | "proposal" | "rollback";
  summary: string; conversationRef?: string | null; rollbackOf?: string | null;
}): Promise<{ spec; record; historyWritten: boolean; drifted: readonly DriftedPage[] }>;

previewSpecChange(deckPath, nextSpec): Promise<{ diff; willDrift; willMiss }>;   // 不写盘
rollbackSpecChange({ deckPath, recordId }): Promise<ApplySpecChangeResult>;

// apps/cli/src/deck/planning-store.ts
appendSpecChangeRecord(deckPath, record): Promise<boolean>;   // 绝不抛，如实返回成败
listSpecChangeRecords(deckPath, { limit? }): Promise<SpecChangeRecord[]>;

// packages/core/src/planning-contracts.ts —— 纯函数，零 node: 依赖（渲染进程要 import）
diffContentSpec(before, after): ContentSpecDiff;
applyRollbackToSpec(current, target): ContentSpec;
```

### 3. Contracts

**写入入口的五步不可拆、不可换序**：校验 → 算新旧指纹 → 更新 `updatedAt` → 原子写 → 追加日志。

- **第 5 步失败不回滚前四步**，只记 stderr 并置 `historyWritten: false`。日志是旁路，
  不允许它反过来阻断规格保存；但**必须如实回报**，否则调用方只能恒报成功。
- **`specId` / `createdAt` 强制沿用磁盘现值**，入参里的同名字段一律忽略——外部规格文件与
  模型都改不动它们（D7 保护条 2）。
- **`style` 变更波及全 deck**：`style` 进指纹投影，改它意味着所有条目的指纹都变，
  `fingerprints` 必须覆盖全部条目。`diffContentSpec` 只置 `styleChanged`、不塞全条目，
  这一支由写入入口显式处理。

**旁路纪律**：`planning/` 整个目录可删，删后只失去回看与回滚能力。
`deck run` / `generate` / `status` / `export` **不得读** `planning/`；
**只读路径不得创建**它——旧格式 deck 打开工作台必须零字节改写。

**日志追加式，回滚是一次新的前进**：回滚 = 把目标记录的前值重新写入 + **追加**一条
`origin: "rollback"` 的新记录。历史只增不减，不提供删除历史的能力。

**版本轴**：`planning/` 下的文件自带局部 `v: 1`，**不挂全仓 `SCHEMA_VERSION`**
（理由见〈独立可寻址契约文件的版本轴〉：`SCHEMA_VERSION` 各处写死 `z.literal`，
旁路文件挂上去等于把自己绑进一次全仓迁移）。读取时坏行跳过，`JSON.parse` 与
`safeParse` 双层保护，单行损坏不丢整个文件。

**判据唯一来源**：过时判定一律走 `reconcileDeckSpec` / `specViewFingerprint`。
禁止第二处指纹比对实现——两处各写一份必然漂移，而漂移是静默的：
界面说「没改」而页面被标成过时，或反之，没有任何东西会报错。

**批量重生成复用单页语义**：逐页走单页执行体，尤其是 `replace-source.ts` 的 `referenceText`
通道（改了规格文字的页要写**新的** `reference_text` 资产并把新 sha 计入指纹）。
与单页的差别只有三处：一次确认覆盖 N 页、进度按页汇报、单页失败不终止其余页。
选页要么全中要么整体拒绝，不做「部分匹配就开跑」——确认框按 N 页给用户看，实跑 N-1 页是静默不一致。

### 4. Validation & Error Matrix

| 情形 | 行为 |
|---|---|
| 新规格不合 `ContentSpecSchema` | 抛 `INVALID_INPUT`，不写盘、不记日志 |
| 日志写失败（目录被占等） | 规格照常落盘，`historyWritten: false`，stderr 告警，**不抛** |
| 回滚目标 recordId 不存在 | `SPEC_HISTORY_RECORD_NOT_FOUND`，deck 零改动 |
| `planning/` 被删后回滚 | 同上——能力可用性随目录消失，deck 加载不受影响 |
| `--all-drifted` 选不出页 | `SPEC_SELECTION_EMPTY` |
| `--pages` 含未知标签 | `SPEC_PAGE_NOT_FOUND`，**整体拒绝** |

### 5. Good / Base / Bad Cases

- Good：改一条条目 → 规格落盘 + 历史 +1 + 该页判为新增过时；回滚 → 规格回前值 + 历史再 +1。
- Base：首次导入（`previous === null`）→ 全部条目记为新增，`fingerprints.before` 全为 `null`。
- Bad：已处于过时的页再改一次 → **不重复计入**「新增过时」（说的是「变为」，不是「处于」）。

### 6. Tests Required

- 回滚三步顺序（先删该次新增 → 按 index 升序插回 → 未触及条目保留）、回滚再回滚。
- 日志写失败时规格仍落盘且不抛；`historyWritten` 为 `false`。
- `previewSpecChange` 跑完 deck 目录**递归内容哈希逐字节相等**（零副作用要断言，不能只靠没触发）。
- 批量重生成后**未选中页的页目录递归内容哈希逐字节相等**——断言整张「相对路径 → sha256」
  映射相等，不是挑几个文件比；并补一条「被选中页确实变了」，否则「什么都没做」也能让它绿。
- 上述哈希类断言必须做**变异验证**：临时把选页改成「选全部」，确认它真的变红。

### 7. Wrong vs Correct

#### Wrong

```ts
// 旁路日志吞掉异常又不回报，调用方只能恒报成功
async function appendRecord(...): Promise<void> {
  try { await appendFile(path, line); } catch (e) { console.error(e); }   // 成败信息就此丢失
}
const record = await appendRecord(...);
return { historyWritten: true };        // 永远为真，「历史没记上」的告警永远不出现
```

#### Correct

```ts
async function appendRecord(...): Promise<boolean> {
  try { await appendFile(path, line); return true; }
  catch (e) { console.error("[spec-history] 写入失败", e); return false; }   // 不抛，但如实回报
}
const historyWritten = await appendRecord(...);   // 规格已落盘，这里为 false 也不回滚
```
