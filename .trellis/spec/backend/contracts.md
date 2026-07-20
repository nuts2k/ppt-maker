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
  }>;
}
```

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
