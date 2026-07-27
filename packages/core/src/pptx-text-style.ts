import { PPTX_WIDE_WIDTH_INCHES } from "./constants.js";
import type { TextReviewBlock } from "./text-blocks.js";

// 文字块 → PPTX 文本框的样式换算。CLI 合成与桌面端合成预览必须共用这一份公式，
// 否则预览与实际导出会出现口径漂移（design §4.3）。

// 源图像素字号 → PPT 磅：源图宽映射到版面宽，16:9 下水平/垂直每英寸像素相同，缩放一致。
export function fontSizePtFromPx(
  fontSizePx: number,
  imageWidth: number,
): number {
  return (fontSizePx * 72 * PPTX_WIDE_WIDTH_INCHES) / imageWidth;
}

export function resolveFontSizePt(
  block: TextReviewBlock,
  imageWidth: number,
): number {
  if (block.style.fontSizePx !== null) {
    return fontSizePtFromPx(block.style.fontSizePx, imageWidth);
  }
  // 缺省时按 bbox 高度与行数估算单行字高。
  const lineCount = Math.max(1, block.lines.length);
  const estimatedPx = (block.bboxPx.height / lineCount) * 0.65;
  return fontSizePtFromPx(estimatedPx, imageWidth);
}

export function toBold(
  weight: TextReviewBlock["style"]["fontWeight"],
): boolean {
  return weight === "semibold" || weight === "bold";
}

export function toAlign(
  align: TextReviewBlock["style"]["horizontalAlign"],
): "left" | "center" | "right" {
  return align ?? "left";
}

export function toValign(
  align: TextReviewBlock["style"]["verticalAlign"],
): "top" | "middle" {
  return align === "middle" ? "middle" : "top";
}
