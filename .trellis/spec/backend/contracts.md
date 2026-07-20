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
