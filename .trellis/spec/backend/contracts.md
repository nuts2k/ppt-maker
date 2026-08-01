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
- **当前源图只认 `sourceImageAssetId`**：换源保留旧图资产（供追溯），`assets` 里会有多条 `source_image`。任何按 `role` 取首条的读法拿到的都是已被替换掉的那张，界面会在换源后继续显示旧图。

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
