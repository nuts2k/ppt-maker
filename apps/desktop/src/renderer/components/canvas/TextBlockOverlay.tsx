import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { TextBlockHandle } from "./TextBlockHandle";
import { TextEditor } from "./TextEditor";

interface TextBlockOverlayProps {
  block: TextReviewBlock;
  imageWidth: number;
  imageHeight: number;
  selected: boolean;
  scale: number;
  onClick(): void;
  onUpdate?:
    | ((blockId: string, patch: Partial<TextReviewBlock>) => void)
    | undefined;
}

/**
 * 分类边框色。V1 用的 #16a34a / #9ca3af / #f59e0b 是 DESIGN.md 之外的强调色
 * （文档明确禁止在签名色板外新增强调色），这里映射到文档内 token：
 * 版面文字＝确认态绿、对象符号＝强描边灰、不确定＝mustard（与全局「待处理」同色）。
 */
const CLASSIFICATION_BORDER: Record<TextReviewBlock["classification"], string> =
  {
    layout_text: "border-success-border",
    object_integrated_symbol: "border-border-strong",
    uncertain: "border-signature-mustard",
  };

const HANDLE_POSITIONS = ["nw", "ne", "sw", "se", "n", "s", "e", "w"] as const;

export function TextBlockOverlay({
  block,
  imageWidth,
  imageHeight,
  selected,
  scale,
  onClick,
  onUpdate,
}: TextBlockOverlayProps): React.JSX.Element {
  const { x, y, width, height } = block.bboxPx;
  const [editing, setEditing] = useState(false);

  const style: React.CSSProperties = {
    left: `${(x / imageWidth) * 100}%`,
    top: `${(y / imageHeight) * 100}%`,
    width: `${(width / imageWidth) * 100}%`,
    height: `${(height / imageHeight) * 100}%`,
  };

  const unreviewed = block.reviewStatus === "unreviewed";

  const handleDragStart = useCallback(() => {}, []);

  const handleDrag = useCallback(
    (delta: { dx: number; dy: number; dw: number; dh: number }) => {
      if (!onUpdate) return;
      onUpdate(block.id, {
        bboxPx: {
          x: block.bboxPx.x + delta.dx,
          y: block.bboxPx.y + delta.dy,
          width: Math.max(10, block.bboxPx.width + delta.dw),
          height: Math.max(10, block.bboxPx.height + delta.dh),
        },
      });
    },
    [block.id, block.bboxPx, onUpdate],
  );

  const handleDragEnd = useCallback(() => {}, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onUpdate) setEditing(true);
    },
    [onUpdate],
  );

  const handleTextCommit = useCallback(
    (text: string) => {
      setEditing(false);
      if (!onUpdate) return;
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      onUpdate(block.id, { text, lines: lines.length > 0 ? lines : [text] });
    },
    [block.id, onUpdate],
  );

  const handleTextCancel = useCallback(() => {
    setEditing(false);
  }, []);

  return (
    // 块内会渲染 8 个拖拽手柄按钮与编辑态 textarea，外层用 <button> 构成非法嵌套，
    // 因此沿用 SlideCard 的做法：div + role="button" 自行补齐键盘可达性。
    // biome-ignore lint/a11y/useSemanticElements: 见上，语义按钮会导致 button 嵌套
    <div
      role="button"
      tabIndex={0}
      style={style}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      className={cn(
        "absolute box-border overflow-visible border-2 text-left transition-colors",
        selected
          ? "border-info-border bg-info/10"
          : CLASSIFICATION_BORDER[block.classification],
        !selected && unreviewed && "border-dashed",
      )}
    >
      {editing ? (
        <TextEditor
          text={block.text}
          onCommit={handleTextCommit}
          onCancel={handleTextCancel}
        />
      ) : (
        // 10px 低于 DESIGN.md 最小字号（legal 13.12px）：这是贴在原图 bbox 上的标注，
        // 尺寸由识别框决定，用界面字号会溢出小块。属画布标注层，不参与界面排版。
        <span className="block truncate p-0.5 text-[10px] leading-tight text-ink">
          {block.text}
        </span>
      )}

      {selected &&
        onUpdate &&
        !editing &&
        HANDLE_POSITIONS.map((pos) => (
          <TextBlockHandle
            key={pos}
            position={pos}
            scale={scale}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
          />
        ))}
    </div>
  );
}
