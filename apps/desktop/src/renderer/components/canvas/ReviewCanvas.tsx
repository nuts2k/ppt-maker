import type { TextReviewBlock } from "@ppt-maker/core";
import { useState } from "react";
import { useCanvasTransform } from "@/hooks/useCanvasTransform";
import { TextBlockOverlay } from "./TextBlockOverlay";

interface ReviewCanvasProps {
  imageUrl: string;
  blocks: TextReviewBlock[];
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string) => void;
  onUpdateBlock?: (blockId: string, patch: Partial<TextReviewBlock>) => void;
}

export function ReviewCanvas({
  imageUrl,
  blocks,
  selectedBlockId,
  onSelectBlock,
}: ReviewCanvasProps): React.JSX.Element {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  const {
    transform,
    containerRef,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    resetView,
  } = useCanvasTransform(size);

  return (
    <div
      role="application"
      aria-label="复核画布"
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={resetView}
      className="relative h-full w-full overflow-hidden bg-surface-strong"
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
        }}
      >
        <img
          src={imageUrl}
          alt="幻灯片源图"
          draggable={false}
          onLoad={(e) =>
            setSize({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight,
            })
          }
          className="block max-w-none select-none"
        />
        {size !== null &&
          blocks.map((block) => (
            <TextBlockOverlay
              key={block.id}
              block={block}
              imageWidth={size.width}
              imageHeight={size.height}
              selected={selectedBlockId === block.id}
              onClick={() => onSelectBlock?.(block.id)}
            />
          ))}
      </div>
    </div>
  );
}
