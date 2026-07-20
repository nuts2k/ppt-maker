# 错误处理

## 稳定领域错误

可预期且调用方需要分支处理的基础错误使用 `FoundationError`：

```ts
throw new FoundationError(
  "INVALID_ASPECT_RATIO",
  "输入图片必须为 16:9，且不会自动裁剪、拉伸或补边",
  validation,
);
```

当前稳定错误码：

| 错误码 | 使用场景 |
|---|---|
| `INVALID_DIMENSIONS` | 图片尺寸或容差不是合法有限数值 |
| `INVALID_ASPECT_RATIO` | 输入超出固定 16:9 容差 |
| `INVALID_BOUNDING_BOX` | bbox 非正尺寸或越出源图 |
| `INVALID_PROVIDER_RESPONSE` | Provider 输出无法满足版本化契约 |
| `MISSING_DEPENDENCY` | 字体、原生二进制等必要依赖缺失 |
| `UNSUPPORTED_ENVIRONMENT` | 当前平台不受支持 |

错误 `details` 必须只包含可序列化诊断数据，不包含大图片、秘密或完整二进制输出。

## 边界处理

- 核心函数抛出 `FoundationError`，不得调用 `process.exit()`。
- Zod 在进程边界解析 JSON；无效响应不得以类型断言绕过。
- CLI 顶层捕获未知错误，向 stderr 输出一行中文错误信息并设置 `process.exitCode = 1`。
- `doctor` 的警告不导致失败；存在 `fail` 项时退出码为 1。
- `probe image` 对合法但非 16:9 的图片输出元数据后设置退出码 1。
- `probe ocr` 和 `probe pptx` 在执行外部工作前先校验 16:9。
- PPTX 默认字体预检失败时阻止生成；仅显式 `--font-face` 允许人工覆盖。

## 常见错误

### 把环境偏离全部视为致命错误

Node 主版本偏离属于可诊断警告，PowerPoint、平台、Swift 或字体等当前命令必要条件缺失才是失败。不要让 `doctor` 因非阻塞偏离失去诊断用途。

### 信任 Provider 的静态类型

Swift/外部进程输出是非可信边界。必须先 `JSON.parse`，再用 `OcrProbeResponseSchema.parse` 校验；不得直接 `as OcrProbeResponse`。

### 静默字体回退

默认输出契约是 `Microsoft YaHei`。缺失时必须报 `MISSING_DEPENDENCY`；不能悄悄改成系统字体。
