import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useMemo } from "react";

interface ConfidenceQueueProps {
  blocks: TextReviewBlock[];
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
}

export function ConfidenceQueue({
  blocks,
  selectedBlockId,
  onSelect,
}: ConfidenceQueueProps): React.JSX.Element {
  const queue = useMemo(
    () =>
      blocks.filter(
        (b) =>
          b.reviewStatus === "unreviewed" && b.classification === "uncertain",
      ),
    [blocks],
  );

  const currentIndex = useMemo(
    () => queue.findIndex((b) => b.id === selectedBlockId),
    [queue, selectedBlockId],
  );

  const navigateTo = useCallback(
    (index: number) => {
      const block = queue[index];
      if (block) {
        onSelect(block.id);
      }
    },
    [queue, onSelect],
  );

  if (queue.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-success">
        所有待定块已处理完毕
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted">
          低置信度队列 ({queue.length})
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded-sm border border-hairline px-2 py-1 text-xs disabled:opacity-30"
            disabled={currentIndex <= 0}
            onClick={() => navigateTo(currentIndex - 1)}
          >
            上一个
          </button>
          <button
            type="button"
            className="rounded-sm border border-hairline px-2 py-1 text-xs disabled:opacity-30"
            disabled={currentIndex >= queue.length - 1}
            onClick={() => navigateTo(currentIndex + 1)}
          >
            下一个
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {queue.map((block, index) => (
          <button
            key={block.id}
            type="button"
            className={`rounded-sm border px-3 py-2 text-left text-sm transition-colors ${
              block.id === selectedBlockId
                ? "border-info-border bg-surface-soft"
                : "border-hairline hover:bg-surface-soft"
            }`}
            onClick={() => {
              onSelect(block.id);
            }}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">{block.id}</span>
              <span className="text-xs text-muted">#{index + 1}</span>
            </div>
            <div className="mt-0.5 truncate text-xs text-body">
              {block.text}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
