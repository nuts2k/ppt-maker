import type { TextReviewBlock } from "@ppt-maker/core";
import { Maximize } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
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
    <div className="flex h-full w-full flex-col bg-surface-sunken">
      <div
        role="application"
        aria-label="复核画布"
        ref={containerRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={resetView}
        className="relative min-h-0 flex-1 overflow-hidden"
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
      </div>

      {/*
        缩放读数与「回到整页」贴在画布下沿的独立条上，**不浮在图上**：
        原实现是 `absolute bottom-3 left-3` 的深色浮标，正好压住内容左下角——
        而 16:9 版式的左下角常有页脚、出处、页码这类小字，被压住时既没法核字
        也看不出底板残留。挪成边条后画布区任何一处都不被遮挡。

        「整页」做成真按钮而不只写一句「双击恢复整页」：跟随当前项会自动改缩放，
        不给显式出口的话用户会以为卡在放大态；且双击是鼠标独占动作，键盘用户
        此前没有任何办法回到整页。
      */}
      <div className="flex shrink-0 items-center gap-3 border-t border-hairline bg-surface px-3 py-0.5">
        <span className="shrink-0 text-2xs font-semibold tabular-nums text-ink-secondary">
          {Math.round(transform.scale * 100)}%
        </span>
        <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted">
          ⌘/Ctrl + 滚轮缩放 · 滚轮平移 · 中键拖动 · 双击恢复整页
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetView}
          title="把整页缩放回视口（在画布上双击同效）"
        >
          <Maximize aria-hidden="true" className="size-3.5" />
          整页
        </Button>
      </div>
    </div>
  );
}
