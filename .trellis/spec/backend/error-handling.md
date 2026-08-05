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
| `INVALID_WORKSPACE` | 工作区 manifest/config 缺失、引用不一致或格式非法 |
| `WORKSPACE_ALREADY_EXISTS` | `slide init` 目标路径已存在，禁止覆盖 |
| `INVALID_STAGE_STATE` | 阶段前置条件未完成或失效操作非法 |
| `ASSET_INTEGRITY_MISMATCH` | 工作区资产字节数或 SHA-256 与 manifest 不一致 |
| `PATH_OUTSIDE_WORKSPACE` | 持久化相对路径试图离开页面工作区 |
| `UPLOAD_CONFIRMATION_REQUIRED` | 云端阶段缺少显式 `--confirm-upload` 门禁 |
| `MISSING_DEPENDENCY` | 字体、原生二进制等必要依赖缺失 |
| `UNSUPPORTED_ENVIRONMENT` | 当前平台不受支持 |
| `SPEC_HISTORY_RECORD_NOT_FOUND` | 回滚指定的变更记录在 `planning/spec-history.jsonl` 中不存在（含 `planning/` 已被删除的情形） |
| `SPEC_SELECTION_EMPTY` | 按次计费的选择集一个都选不出：批量重生成按「已过时」选页时一页都没有；`deck generate` 的 `entryIds` 为空数组（空数组是「一条都没选」，**省略**该参数才表示建全部新增条目） |
| `SPEC_PAGE_NOT_FOUND` | 选择集里有定位不到的目标：批量重生成 `--pages` 的未知页标签；`deck generate` 的 `entryIds` 里有规格中不存在的条目。两者都**整体拒绝**，不部分执行 |

错误 `details` 必须只包含可序列化诊断数据，不包含大图片、秘密或完整二进制输出。

## 边界处理

- 核心函数抛出 `FoundationError`，不得调用 `process.exit()`。
- Zod 在进程边界解析 JSON；无效响应不得以类型断言绕过。
- CLI 顶层捕获未知错误，向 stderr 输出一行中文错误信息并设置 `process.exitCode = 1`。
- `doctor` 的警告不导致失败；存在 `fail` 项时退出码为 1。
- `probe image` 对合法但非 16:9 的图片输出元数据后设置退出码 1。
- `probe ocr` 和 `probe pptx` 在执行外部工作前先校验 16:9。
- PPTX 默认字体预检失败时阻止生成；仅显式 `--font-face` 允许人工覆盖。
- `slide init` 不得替换已有目录，即使目标目录为空；POSIX `rename` 可以替换空目录，因此重命名前必须再次检查目标不存在。
- 阶段失败写入新的 attempt 记录，不覆盖先前成功资产；派生产物使用独立 attempt 路径。
- `slide analyze` 在读取 API Key 或创建 attempt 前先检查上传确认；缺少确认时不得访问网络。
- 旁路日志（`planning/spec-history.jsonl`）的写失败**不得**上抛，只记 stderr；但写入函数必须
  **如实返回成败**（`Promise<boolean>`），由调用方决定怎么告知用户。吞掉异常是纪律，
  藏住结果不是——调用方拿不到信号就只能恒报成功，那条「历史没记上」的告警就永远不会出现。
- 选择集失败（`SPEC_SELECTION_EMPTY` / `SPEC_PAGE_NOT_FOUND`）一律在**任何计费调用之前**抛出。
  两条路的「最早可判点」不同，各自前移到自己的最早点，不要糊成一句：
  - 批量重生成（`regenerate-batch.ts` 的 `resolveSelection`）：**上传确认之后、联网之前**——
    选页要先读 deck 才知道有哪些页可选。
  - `deck generate` 的 `entryIds`（`generate.ts` 的 `assertKnownEntryIds`）：更早，在**建 deck 之前**。
    有 `--spec` 时读完外部规格即可判（外部规格与落盘副本的条目集合相同）；无 `--spec` 时规格来自
    deck 内部，判点在读到它之后，而那条路径本就不会新建 deck。两支都不留半成品 deck 目录。
    `entryIds: []` 更早，排在 `--confirm-upload` 检查之后、任何 I/O 之前。
  「未知」的判据是**规格里根本没有这个条目**。已经建过页的条目（在规格里、不在 `newEntries` 里）
  **不算未知**，落进既有 `skipped` 的幂等口径：调用方（界面勾选）的待建列表来自一份可能稍旧的
  页面快照，把「刚被别处建掉的条目」判成错误会让一次正常的补页整批失败。
  单页 / 单条目执行失败不终止其余，退出码沿用「一页都没成才算失败」。

  **`skipped` 自 `entryIds` 引入起含两类，消费方不得当成一类解释**：它是
  `spec.entries` 减去 `targets`，因此既有「此前已建过页」（幂等跳过，原始含义），
  也有「**本次未勾选**」。后者是调用方自己的选择，不是意外，报出来反而像出了事。
  2026-08-04 走查实测：完成提示照着 `skipped` 说「被跳过的条目此前已经建过页」，
  而那 3 条是用户刚取消勾选的，一次都没建过。消费方要区分这两类，**不要去拆
  `skipped`**——用自己手上的「请求了几条」减去 `created` 与 `failed` 更紧，
  也不会把调用方从没请求过的历史条目一并报出来。判据与复发条件见
  [静默失败诊断指南 · 编码期的预防清单](../guides/silent-failure-thinking-guide.md)。
- **按次计费的命令里，「会失败的校验一律前移」是硬约束而非风格偏好。** 判到第 3 条才发现第 5 条
  非法时，前 2 次调用的钱已经花掉且不可撤销——这与纯本地命令「早报错更友好」是两个量级的事。
  实例：`generate.ts` 的规格文件解析排在建 deck 之前（`--spec 坏文件 --deck 新路径` 否则会先建出
  一个空 deck 再抛错）、`entryIds` 校验排在建页循环之前、`slide analyze` 的上传确认排在读 API Key
  与创建 attempt 之前。验收判据是**零副作用**：抛错后目录整张「相对路径 → sha256」映射逐字节不变，
  只断言「抛了正确的错误码」查不出建到一半的情况。

## 常见错误

### 把环境偏离全部视为致命错误

Node 主版本偏离属于可诊断警告，PowerPoint、平台、Swift 或字体等当前命令必要条件缺失才是失败。不要让 `doctor` 因非阻塞偏离失去诊断用途。

### 信任 Provider 的静态类型

Swift/外部进程输出是非可信边界。必须先 `JSON.parse`，再用 `OcrProbeResponseSchema.parse` 校验；不得直接 `as OcrProbeResponse`。

### 静默字体回退

默认输出契约是 `Microsoft YaHei`。缺失时必须报 `MISSING_DEPENDENCY`；不能悄悄改成系统字体。
