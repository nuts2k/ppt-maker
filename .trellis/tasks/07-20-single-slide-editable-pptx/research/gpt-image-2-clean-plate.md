# GPT Image 2 Clean Plate 技术约束

记录日期：2026-07-20

## 已确认选择

- M1 的 clean plate 唯一生成路径为 OpenAI Image API。
- 模型固定为 `gpt-image-2`。
- 不提供其他 Provider，也不提供人工导入 clean plate 的回退路径。
- 失败或质量不足时只能修正上游文字块、mask、提示词或 API 参数后重试。

## 官方 API 契约

- 单次图片编辑应使用 Image API `POST /v1/images/edits`；官方指南建议单图单提示词编辑使用 Image API，而不是 Responses API。
- Node.js SDK 对应 `client.images.edit({ model: "gpt-image-2", image, mask, prompt, ... })`。
- API Key 使用 `OPENAI_API_KEY`。
- GPT Image 模型的 mask 是提示性引导，模型可能不会完全按 mask 精确边界编辑，因此不能把 API 成功响应等同于 clean plate 质量通过。
- 源图和 mask 必须格式、尺寸一致且小于 50 MB；mask 必须包含 alpha 通道。
- `gpt-image-2` 总是以高保真方式处理图片输入，API 不允许调整 `input_fidelity`。
- Image API 返回 base64 图片数据；M1 使用 PNG，避免有损压缩影响残留和误改检查。
- `gpt-image-2` 不支持透明背景，本任务输出本来就是完整不透明页面，因此不构成限制。

## 尺寸约束

`gpt-image-2` 支持满足下列条件的任意 `size`：

- 最长边不超过 3840 px。
- 两条边都必须是 16 px 的倍数。
- 长短边比例不超过 3:1。
- 总像素数在 655,360 到 8,294,400 之间。

官方列出的 16:9 常用尺寸包括 `2048x1152` 和 `3840x2160`。高于 `2560x1440` 总像素量的输出被标记为实验性，因此 M1 默认尺寸需要在质量、成本、延迟和稳定性之间明确选择。

M1 已确认固定使用：

- `size: "2048x1152"`
- `quality: "high"`
- `output_format: "png"`

该配置保持标准 16:9，并避开 4K 实验性输出。M1 不提供运行时切换，以确保不同尝试和样例的结果可比较。

## 模型与文档状态

- 模型页给出的当前快照为 `gpt-image-2-2026-04-21`，支持 `image_edit` 和 inpainting。
- 图像生成指南和模型页明确支持 `gpt-image-2`。
- 截至记录日期，OpenAPI `/images/edits` 的 endpoint summary/示例仍主要列举旧 GPT Image 模型，没有同步展示 `gpt-image-2`；实现应以模型页和图像生成指南的明确说明为准，并通过真实请求验证 SDK/endpoint 行为。

## 对 M1 设计的影响

- clean plate 阶段必须保存请求参数、提示词版本、请求 ID、用量、耗时、输出哈希和错误。
- 每次输出必须单独验证文字残留、容器完整性和 mask 外误改。
- 未通过验证时不得继续生成正式 PPTX，也不得用人工文件替换 API 产物。
- mask 精度仍然重要，但不能依赖 mask 本身保证非破坏性；提示词和输出检查同样属于质量契约。

## 官方资料

- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2)
- [Create image edit API](https://developers.openai.com/api/docs/api-reference/images/createEdit)
