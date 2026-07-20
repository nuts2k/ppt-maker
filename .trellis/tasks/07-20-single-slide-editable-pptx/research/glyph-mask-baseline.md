# M1 字形 Mask 技术基线

记录日期：2026-07-20

## 当前实现能力

- M0 Apple Vision 适配器目前只输出每个识别文本块的轴对齐像素 bbox。
- 核心契约保存源图像素坐标，但尚未表达字符四边形、mask 参数、排除区域或人工 mask 校正记录。

## Apple Vision 可扩展能力

macOS Vision 的 `VNRecognizedText.boundingBox(for:)` 可以针对字符串 range 返回 `VNRectangleObservation`，因此 M1 可以取得单字符或子串的四边形，辅助旋转估计、局部像素采样和 mask 预览。

但 macOS SDK 的公开头文件同时明确说明：

> The bounding boxes are not guaranteed to be an exact fit around the characters and are purely meant for UI purposes and not for image processing.

因此字符四边形不能直接视为字形笔画 mask，也不能仅通过扩大/填充字符框满足“只移除文字笔画、保留容器”的要求。

## M1 建议基线

自动 mask 应采用两层约束：

1. 几何范围：Vision 字符四边形、云端视觉候选和人工校正后的文字区域限定允许寻找字形的局部范围。
2. 像素分割：在局部范围内根据颜色、亮度、边缘和连通域产生实际笔画像素候选，并允许为每个文本块配置膨胀、阈值和排除区域。

生成后必须输出：

- 原尺寸带 alpha 的 API mask。
- 黑白 mask 预览。
- mask 叠加源图预览。
- 每个文字块的 mask 面积和相对 bbox 覆盖率，帮助识别整框误覆盖。

## 风险

- 渐变、描边、阴影和多色艺术字可能无法用单一颜色阈值覆盖。
- 文字与容器边框颜色相同时，连通域可能把结构线一并选中。
- 云端图像编辑的 mask 只是引导，即使本地 mask 精确，也仍需验证 mask 外误改。
- M1 已确认禁止人工修正、替换或导入 mask PNG，因此复杂页面的质量必须通过结构化文字区域、分割参数、算法迭代和重新生成来达成。

## 已确认约束

- mask PNG 是派生产物，不是人工输入。
- 开发者只能修改结构化文字块、字符/子区域、旋转、分类、参与状态和明确暴露的生成参数。
- mask 阶段保存输入哈希和输出哈希；clean plate 阶段必须验证 mask 未被外部修改。

## 证据来源

- macOS SDK：`Vision.framework/Headers/VNObservation.h` 中 `VNRecognizedText.boundingBoxForRange` 的公开说明。
- 当前实现：`native/macos-vision-ocr/Sources/main.swift`。
