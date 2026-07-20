# M1 单页图片转可编辑 PPTX 原型执行计划

## 1. 规划与技术准备

- [x] 完成 PRD convergence pass，用户评审 `prd.md`、`design.md` 和本计划。
- [x] 激活任务后加载 `trellis-before-dev`、backend spec、跨层和代码复用指南。
- [x] 固定 OpenAI SDK 版本，并验证 Node.js 24 下 Responses API 图片输入、Structured Outputs 与 Zod 解析类型契约。
- [ ] 验证 Node.js 24 下 Image API `gpt-image-2` 编辑请求的类型契约。
- [ ] 准备仓库内合成复杂 fixture；实现开始后由开发者提供一张真实复杂页面的本地路径。
- [ ] 保持 `open-design/` 在 workspace、格式化、构建、测试和所有写入范围之外。

## 2. M1 工作区和阶段图

- [x] 定义页面工作区、资产记录、阶段尝试、Provider 调用、人工接受和报告 Schema。
- [x] 实现 SHA-256、原子写入、相对路径约束和派生产物完整性校验。
- [x] 实现阶段 DAG、输入指纹、复用、stale 标记和下游失效规则。
- [x] 实现 `slide init` 与工作区加载/校验。
- [x] 为阶段图、哈希失效、错误恢复和路径安全增加测试。

## 3. OCR、视觉分析和复核文件

- [x] 扩展 Swift Vision 输出字符/子串 `glyphHints` 四边形，不把它描述为精确字形。
- [x] 将 OCR 探针升级为工作区 `slide ocr` 阶段，保留完全离线属性和 Provider 记录。
- [x] 实现 OpenAI Responses API `gpt-5.6-sol` 视觉 Provider，固定 original/high/Structured Outputs。
- [x] 实现 `slide analyze --confirm-upload`，记录完整请求元数据并拒绝隐式上传。
- [x] 合并 OCR、视觉、参考文案候选，生成 `review/text-blocks.json`，不覆盖既有人工确认值。
- [x] 实现 `slide validate-review`，覆盖分类、mask 参与、坐标、四边形、旋转、样式和风险接受规则。
- [x] 增加 Provider fake 测试、Schema 测试、候选冲突与敏感信息不落盘测试。

## 4. 自动字形 Mask

- [ ] 选择并验证 Node 24/macOS arm64 可重复的本地图像像素处理依赖；记录选择依据和回滚方案。
- [ ] 实现基于复核区域、字符提示、颜色/亮度、边缘和连通域的局部分割。
- [ ] 实现每块结构化参数、排除多边形、受控膨胀和旋转区域处理。
- [ ] 生成 API alpha mask、黑白预览、源图叠加预览和覆盖率统计。
- [ ] 保存算法版本、全部输入哈希和输出哈希；检测人工修改/替换 mask 并阻止下游。
- [ ] 使用合成 fixture 建立像素统计基线，覆盖容器边框、同色结构、旋转文字和艺术字。

## 5. GPT Image 2 Clean Plate

- [ ] 将用户确认的去字规则版本化为 clean plate 提示词模板。
- [ ] 实现 OpenAI Image API `gpt-image-2` Provider，固定 2048x1152/high/PNG。
- [ ] 实现 `slide clean --confirm-upload`，上传前展示源图和 mask 范围，保存请求 ID、用量、耗时、响应和哈希。
- [ ] 支持多次尝试但不覆盖旧结果；每次尝试关联具体 mask 和提示词版本。
- [ ] 实现尺寸、文字残留候选、mask 外差异和容器检查辅助产物。
- [ ] 实现 `slide accept-clean`，只有当前产物哈希可被接受，上游变化后自动 stale。
- [ ] 在有 `OPENAI_API_KEY` 且用户明确批准计费调用后运行真实合成页与真实页实验。

## 6. PPTX 合成与最终接受

- [ ] 将 M0 PPTX 探针升级为正式单页合成器，读取已接受 clean plate 和已复核文字块。
- [ ] 实现微软雅黑预检、文本框位置/尺寸/旋转/换行/样式/zIndex 映射。
- [ ] 拒绝未复核目标文字、未接受 clean plate、stale 接受记录和对象内符号文本框。
- [ ] 自动检查 PPTX ZIP/XML、16:9、文字内容、字体声明和形状数量。
- [ ] 实现 `slide accept-pptx`，记录 PowerPoint for Mac 人工检查结果和产物哈希。

## 7. 增量重跑与报告

- [ ] 实现所有显式阶段命令及 `slide run --from`；在上传和人工门前停止。
- [ ] 验证文字内容/样式变更只重跑 PPTX，下游几何/分类变更重跑 mask、clean 和 PPTX。
- [ ] 实现 `slide report`，分别报告 OCR/内容、分类、mask、clean plate、PPTX 和人工耗时。
- [ ] 报告未通过项目不得汇总为成功，且必须区分自动检查和人工接受。
- [ ] 更新 README，给出从 init 到最终接受的完整单页操作示例。

## 8. 双样例验收

- [ ] 合成 fixture 自动化覆盖中文、英文/混排、容器内文字、对象内符号、旋转文字或艺术字。
- [ ] 使用开发者实际生成的一张复杂页面完成完整本地工作区流程。
- [ ] 人工确认真实页全部目标文字进入原生层，clean plate 无目标文字残留，容器和对象内符号未破坏。
- [ ] 在 PowerPoint for Mac 检查 16:9、可打开、可编辑、微软雅黑和文本框排版。
- [ ] 记录人工复核时间但不作为硬门槛。

## 9. 质量、规范与收尾

- [ ] 运行 `pnpm format:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- [ ] 在 Node.js 24 环境运行相关测试和 CLI 基本链路。
- [ ] 运行任务 validate、`git diff --check`，确认 `open-design/` 无改动。
- [ ] 运行 `trellis-check`，复核跨层 Schema、阶段数据流、外部调用门禁、敏感信息和测试覆盖。
- [ ] 使用真实实现更新 backend contracts、错误、质量和日志规范；不填写数据库/frontend 虚构约定。
- [ ] 更新 `ROADMAP.md` M1 状态、技术结论和是否进入 M2 的条件。
- [ ] 用户确认结果后提交并归档 M1；父路线图继续保留。

## 10. 计划验证命令

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm ppt-maker slide init <fixture> --workspace artifacts/m1-fixture
pnpm ppt-maker slide ocr artifacts/m1-fixture
pnpm ppt-maker slide validate-review artifacts/m1-fixture
pnpm ppt-maker slide mask artifacts/m1-fixture
python3 ./.trellis/scripts/task.py validate 07-20-single-slide-editable-pptx
git diff --check
```

云端命令和 PowerPoint 接受属于显式、可能计费/人工的验证步骤，不进入无凭据默认测试。

## 11. 风险与回滚点

- OpenAI API 或模型契约变化：保留版本化 Provider 记录，更新适配器和 spec，不放宽结构化校验。
- 自动 mask 不能保持容器：停止进入 clean 阶段，调整局部分割；禁止人工 bitmap 绕过。
- GPT Image 2 质量不合格：保留全部尝试，调整上游和提示词后重试；不切 Provider、不导入人工 clean plate。
- 真实页面证明路线不可行：形成可复现实验结论，M1 不标记完成，并在父路线图决定调整或停止。
