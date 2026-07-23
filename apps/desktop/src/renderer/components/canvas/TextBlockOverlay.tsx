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

const CLASSIFICATION_BORDER: Record<TextReviewBlock["classification"], string> =
  {
    layout_text: "border-block-layout",
    object_integrated_symbol: "border-block-object",
    uncertain: "border-block-uncertain",
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
        <span className="block truncate p-0.5 text-[10px] leading-tight text-ink">
          {block.text}
        </span>
      )}

      {selected && onUpdate && !editing && (
        <>
          {HANDLE_POSITIONS.map((pos) => (
            <TextBlockHandle
              key={pos}
              position={pos}
              scale={scale}
              onDragStart={handleDragStart}
              onDrag={handleDrag}
              onDragEnd={handleDragEnd}
            />
          ))}
        </>
      )}
    </div>
  );
}
