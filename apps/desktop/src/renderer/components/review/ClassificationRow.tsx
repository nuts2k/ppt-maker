import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

/**
 * 「分类待确认」项：逐项判断这块字到底是版式文字还是对象内嵌符号。
 *
 * 这是 PRD F-7 的唯一兜底——被误判为 `object_integrated_symbol` 的文字既不进 mask
 * 也不进 PPTX 文本层，会永久留在位图里，属于静默漏字；而原本该发现它的低置信度
 * 队列在真实数据下恒空。所以该分区默认展开、要求逐项过目。
 *
 * 切分类必须同时改 `includeInMask`：阶段 A 新增的 `LAYOUT_TEXT_MUST_BE_MASKED`
 * 规则把「layout_text 却不参与 mask」判为 error，只改分类会一改就触发校验失败。
 */

interface ClassificationRowProps {
  readonly block: TextReviewBlock;
  readonly onUpdateBlock: (
    blockId: string,
    patch: Partial<TextReviewBlock>,
  ) => void;
}

/** DESIGN.md `button-secondary` 的紧凑版，选中态用 `surface-strong` 表达 */
const CHOICE_BUTTON =
  "rounded-sm border px-3 py-1 text-sm transition active:border-border-strong";

export function ClassificationRow({
  block,
  onUpdateBlock,
}: ClassificationRowProps): React.JSX.Element {
  const handleLayoutText = useCallback(() => {
    onUpdateBlock(block.id, {
      classification: "layout_text",
      includeInMask: true,
    });
  }, [block.id, onUpdateBlock]);

  const handleObjectSymbol = useCallback(() => {
    onUpdateBlock(block.id, {
      classification: "object_integrated_symbol",
      includeInMask: false,
    });
  }, [block.id, onUpdateBlock]);

  const isLayoutText = block.classification === "layout_text";
  const isObjectSymbol = block.classification === "object_integrated_symbol";

  return (
    <div className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
        {block.text}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleLayoutText}
          title="这是页面版式上的文字，应当抹除并重建为原生文本框（⌥1）"
          className={cn(
            CHOICE_BUTTON,
            isLayoutText
              ? "border-border-strong bg-surface-strong font-medium text-ink"
              : "border-hairline bg-canvas text-body",
          )}
        >
          改为版式文字
        </button>
        <button
          type="button"
          onClick={handleObjectSymbol}
          title="这是图形对象自带的符号，应当保留在底板位图里（⌥2）"
          className={cn(
            CHOICE_BUTTON,
            isObjectSymbol
              ? "border-border-strong bg-surface-strong font-medium text-ink"
              : "border-hairline bg-canvas text-body",
          )}
        >
          改为对象符号
        </button>
        {block.classification === "uncertain" && (
          <span className="text-sm font-medium tracking-[0.16px] text-muted">
            当前为「待定」，必须二选一
          </span>
        )}
      </div>
    </div>
  );
}
