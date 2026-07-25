import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * 低置信度队列（PRD F3.2，视觉按 DESIGN.md 重做）。
 *
 * 逻辑与 V1 一致：筛出「未复核 + 待定」的块，提供上一个/下一个跳转。
 * 视觉调整：字号统一 14px、去掉 hover 态、选中项用背景色调切换表达（无强调描边）。
 */

interface ConfidenceQueueProps {
  blocks: TextReviewBlock[];
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
}

const NAV_BUTTON =
  "rounded-sm border border-hairline px-2.5 py-1 text-sm text-ink transition active:border-border-strong disabled:opacity-40";

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
      if (block) onSelect(block.id);
    },
    [queue, onSelect],
  );

  if (queue.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm font-medium text-success">
        所有待定块已处理完毕
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-6">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-medium tracking-[0.16px] text-muted">
          低置信度队列 {queue.length}
        </h3>
        <button
          type="button"
          className={NAV_BUTTON}
          disabled={currentIndex <= 0}
          onClick={() => navigateTo(currentIndex - 1)}
        >
          上一个
        </button>
        <button
          type="button"
          className={NAV_BUTTON}
          disabled={currentIndex >= queue.length - 1}
          onClick={() => navigateTo(currentIndex + 1)}
        >
          下一个
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {queue.map((block, index) => (
          <li key={block.id}>
            <button
              type="button"
              onClick={() => onSelect(block.id)}
              className={cn(
                "flex w-full flex-col gap-1 rounded-sm border px-4 py-2 text-left transition",
                block.id === selectedBlockId
                  ? "border-border-strong bg-surface-strong"
                  : "border-hairline active:border-border-strong",
              )}
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {block.text || "（空文本）"}
                </span>
                <span className="shrink-0 text-sm font-medium text-muted">
                  #{index + 1}
                </span>
              </span>
              <span className="truncate text-sm text-muted" title={block.id}>
                {block.id}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
