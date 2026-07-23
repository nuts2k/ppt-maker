# M2 技术设计

## 1. 总体架构

M2 分三个阶段顺序执行，每个阶段有明确的输入输出和人工门：

```
阶段 A: 图片生成
  输入: 逐页提示词（~25 条）
  输出: artifacts/m2-pages/page-NN.png
  人工门: 筛选不合格图片

阶段 B: 批量转换
  输入: 筛选后的 PNG 集合
  输出: 每页独立工作区 + SlideReport
  人工门: assist-review --confirm-api、clean --confirm-upload、逐页人工标注

阶段 C: 汇总评测与决策
  输入: 全部 SlideReport + 人工标注
  输出: 汇总报告 + 失败模式目录 + 路线决策文档
```

## 2. 图片生成 Provider

扩展现有 `openai-image.ts`，新增生成（非编辑）接口：

```typescript
// 固定档位，与 clean plate 编辑接口对齐
export const IMAGE_GEN_MODEL = "gpt-image-2";       // 同 OPENAI_IMAGE_MODEL
export const IMAGE_GEN_SIZE = "2048x1152";           // 同 CLEAN_PLATE_SIZE
export const IMAGE_GEN_QUALITY = "high";
export const IMAGE_GEN_FORMAT = "png";
```

调用 OpenAI SDK `client.images.generate()`，参数：
- `model`: gpt-image-2
- `prompt`: 逐页提示词（视觉规范前缀 + 页面内容描述）
- `size`: 2048x1152
- `quality`: high
- `output_format`: png
- `n`: 1

返回 base64 PNG，写入 `artifacts/m2-pages/page-NN.png`。

## 3. 提示词结构

每页提示词由两部分拼接：

**固定视觉规范前缀**（所有页面共享）：
- 16:9 宽屏演示文稿页面
- 商务蓝色系配色（深蓝 #002542、主蓝 #00589E、亮蓝 #006FC6、浅蓝 #F1F8FC、白色）
- 中文微软雅黑字体
- 线条清晰、结构化布局、避免卡片过多文字过密

**逐页内容描述**（每页独立）：
- 页面类型（封面/过渡/内容/架构/时间线/结尾）
- 页面标题和核心内容
- 建议的图示形式（流程图/蓝图/矩阵/架构图等）
- 文字内容要点

提示词文件保存在 `research/page-prompts.json`，结构：
```json
[
  {
    "pageNumber": 1,
    "pageType": "cover",
    "title": "...",
    "prompt": "完整拼接后的提示词"
  }
]
```

## 4. 批量转换工作流

不新建 CLI 命令，用 shell 脚本串联已有命令：

```bash
for page in artifacts/m2-pages/page-*.png; do
  slug=$(basename "$page" .png)
  ws="artifacts/m2-workspaces/$slug"
  pnpm ppt-maker slide init "$page" --workspace "$ws"
  pnpm ppt-maker slide ocr "$ws"
  pnpm ppt-maker slide run --from review "$ws"
  # 停在 assist-review 人工门
done
```

assist-review、clean、accept 等需要 API 调用或人工确认的阶段，由开发者逐页或批量显式触发。

## 5. 人工标注 Schema

在每个工作区内新增 `stages/eval/annotation.json`：

```json
{
  "pageNumber": 1,
  "pageType": "cover",
  "missedTextBlocks": 0,
  "wrongTextContent": 0,
  "classificationErrors": 0,
  "containerDamage": 0,
  "symbolFalseRemoval": 0,
  "notes": "",
  "annotatedBy": "nuts2k",
  "annotatedAt": "2026-07-21T..."
}
```

可手工编辑 JSON 完成标注，不需要 UI。

## 6. 汇总报告

读取全部工作区的 `SlideReport` + `annotation.json`，生成 `artifacts/m2-eval/summary.json`：

- 按页面类型分组的指标统计
- 失败模式列表（阶段 × 页面类型 × 失败原因）
- 各阶段 Provider 调用成本汇总
- 人工耗时汇总

## 7. 成本估算

- 图片生成：~25 × gpt-image-2 生成 = ~25 次调用
- AI 辅助复核：~25 × gpt-5.6-luna 调用
- Clean plate：~25 × gpt-image-2 编辑 = ~25 次调用
- 总计约 75 次 API 调用，需用户确认计费。
