import type { TextReviewBlock } from "@ppt-maker/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCanvasTransform } from "@/hooks/useCanvasTransform";
import { partitionOf, type ReviewPartition } from "@/lib/review-partition";
import { TextBlockOverlay } from "./TextBlockOverlay";

interface ReviewCanvasProps {
  readonly imageUrl: string;
  readonly blocks: readonly TextReviewBlock[];
  /** 当前复核项；画布据此高亮 + 自动居中 */
  readonly currentBlockId: string | null;
  readonly onSelectBlock?: ((blockId: string) => void) | undefined;
  /** 块整体拖动写回；不传则画布只读 */
  readonly onUpdateBlock?:
    | ((blockId: string, patch: Partial<TextReviewBlock>) => void)
    | undefined;
}

/**
 * 复核画布：只读定位标注层。文本编辑与分类切换都在左侧列表完成（design.md §4.2），
 * 这里只负责「当前项在页面的哪个位置」——高亮、自动居中、块整体拖动。
 */
export function ReviewCanvas({
  imageUrl,
  blocks,
  currentBlockId,
  onSelectBlock,
  onUpdateBlock,
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
    focusOn,
  } = useCanvasTransform(size);

  const currentPartition = useMemo<ReviewPartition | null>(() => {
    const currentBlock = blocks.find((block) => block.id === currentBlockId);
    return currentBlock === undefined ? null : partitionOf(currentBlock);
  }, [blocks, currentBlockId]);

  // 跟随只在「当前项切换」时发生：effect 依赖仅取 currentBlockId，
  // 块坐标从 ref 读取，否则拖动块导致 blocks 变化会把视口一直拽回中心。
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  useEffect(() => {
    if (currentBlockId === null || size === null) {
      return;
    }
    const target = blocksRef.current.find(
      (block) => block.id === currentBlockId,
    );
    if (target === undefined) {
      return;
    }
    focusOn(target.bboxPx);
  }, [currentBlockId, size, focusOn]);

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
              current={block.id === currentBlockId}
              samePartition={
                currentPartition === null ||
                partitionOf(block) === currentPartition
              }
              scale={transform.scale}
              onClick={() => onSelectBlock?.(block.id)}
              onUpdate={onUpdateBlock}
            />
          ))}
      </div>

      {/* 跟随会自动改缩放，所以必须把「怎么回到整页」摆出来，否则用户会以为卡在放大态 */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-sm bg-surface-dark/70 px-2 py-1 text-sm text-on-dark">
        {Math.round(transform.scale * 100)}%
        <span className="opacity-70">双击恢复整页</span>
      </div>
    </div>
  );
}
