import type { TextReviewBlock } from "@ppt-maker/core";
import { cn } from "@/lib/utils";

interface TextBlockOverlayProps {
  block: TextReviewBlock;
  // 底图原始像素尺寸，用于把 bboxPx 换算为百分比定位
  imageWidth: number;
  imageHeight: number;
  selected: boolean;
  onClick(): void;
}

// 分类到边框颜色的映射类
const CLASSIFICATION_BORDER: Record<TextReviewBlock["classification"], string> =
  {
    layout_text: "border-block-layout",
    object_integrated_symbol: "border-block-object",
    uncertain: "border-block-uncertain",
  };

export function TextBlockOverlay({
  block,
  imageWidth,
  imageHeight,
  selected,
  onClick,
}: TextBlockOverlayProps): React.JSX.Element {
  const { x, y, width, height } = block.bboxPx;
  // 按百分比定位，随画布 transform 缩放而自适应
  const style: React.CSSProperties = {
    left: `${(x / imageWidth) * 100}%`,
    top: `${(y / imageHeight) * 100}%`,
    width: `${(width / imageWidth) * 100}%`,
    height: `${(height / imageHeight) * 100}%`,
  };

  const unreviewed = block.reviewStatus === "unreviewed";

  return (
    <button
      type="button"
      style={style}
      onClick={onClick}
      className={cn(
        "absolute box-border overflow-hidden border-2 text-left transition-colors",
        selected
          ? "border-link bg-link/10"
          : CLASSIFICATION_BORDER[block.classification],
        !selected && unreviewed && "border-dashed",
      )}
    >
      <span className="block truncate p-0.5 text-[10px] leading-tight text-ink">
        {block.text}
      </span>
    </button>
  );
}
