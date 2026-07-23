# M2 执行计划

## 1. 准备

- [x] 扩展 `openai-image.ts`，新增 `generatePageImage()` 生成接口（非编辑），固定 gpt-image-2 / 2048x1152 / high / png。
- [ ] 在 `@ppt-maker/core` 新增人工标注 Schema（`EvalAnnotationSchema`）。
- [x] 新增独立脚本 `scripts/generate-m2-pages.ts`（支持断点续跑、记录 Provider 元数据）。

## 2. 逐页提示词设计

- [x] 基于 PPSO 原始需求，将 15 页结构扩展为 25 页（拆分重型页、增加过渡页、补充细节页）。
- [x] 为每页编写内容描述和图片生成提示词。
- [x] 视觉规范（色值、布局、字体）嵌入每条提示词。
- [x] 保存完整提示词到 `research/page-prompts.json`。

## 3. 批量图片生成

- [ ] 用户确认计费后，逐页调用 gpt-image-2 生成接口。
- [ ] 输出保存到 `artifacts/m2-pages/page-NN.png`。
- [ ] 记录每次生成的 Provider 元数据（模型、请求 ID、耗时、用量）。
- [ ] 用户人工筛选，去掉质量不合格的图片，必要时重新生成。

## 4. 批量转换

- [ ] 对筛选后的每张图片，创建独立工作区 `artifacts/m2-workspaces/page-NN/`。
- [ ] 批量运行离线阶段：init → ocr → review（停在人工门）。
- [ ] 用户确认后批量运行 assist-review。
- [ ] 批量运行 validate-review → mask。
- [ ] 用户确认后批量运行 clean（每页一次 gpt-image-2 编辑调用）。
- [ ] 逐页运行 accept-clean → pptx → accept-pptx → report。

## 5. 人工标注

- [ ] 对每页在 PowerPoint for Mac 中打开 PPTX，对照源图标注漏字/错字/分类/容器/符号。
- [ ] 将标注结果写入 `stages/eval/annotation.json`。

## 6. 汇总评测

- [ ] 实现汇总脚本，读取全部 SlideReport + annotation.json。
- [ ] 按页面类型分组统计五项指标。
- [ ] 生成失败模式目录。
- [ ] 输出 `artifacts/m2-eval/summary.json` 和人类可读的 Markdown 报告。

## 7. 路线决策

- [ ] 基于汇总结果撰写书面决策：继续 M3 / 增加技术实验 / 收紧支持边界。
- [ ] 更新 ROADMAP.md M2 状态。
- [ ] 提交并归档任务。

## 8. 验证命令

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
python3 ./.trellis/scripts/task.py validate 07-21-evaluation-suite
git diff --check
```

## 9. 风险与回滚点

- gpt-image-2 生成的页面文字不清晰：调整提示词，增加文字清晰度要求；不合格图片重新生成。
- 大量页面 clean plate 失败：记录失败模式，不强行标记通过；这本身就是 M2 要发现的问题。
- API 成本超预期：每阶段前确认计费；生成和转换分开，生成不满意不进入转换。
- 评测门槛不合理：门槛可在评测过程中调整，但必须在决策文档中说明调整理由。
