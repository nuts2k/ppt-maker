import type { TextReviewBlock } from "@ppt-maker/core";
// Image 与全局构造函数同名，一律用别名引入，避免读代码时误认
import { Image as ImageIcon, Type as TypeIcon } from "lucide-react";
import { useCallback } from "react";
import { Button, Kbd } from "@/components/ui";

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
      <div className="flex flex-wrap items-center gap-1.5">
        {/* 快捷键直接印在按钮上：这一页的验收标准是「全程仅用键盘复核完一页」，
            把键位藏进 title 等于只有鼠标用户看得到 */}
        <Button
          size="sm"
          selected={isLayoutText}
          onClick={handleLayoutText}
          title="这是页面版式上的文字，应当抹除并重建为原生文本框（⌥1）"
        >
          <TypeIcon aria-hidden="true" className="size-3.5" />
          版式文字
          <Kbd>⌥1</Kbd>
        </Button>
        <Button
          size="sm"
          selected={isObjectSymbol}
          onClick={handleObjectSymbol}
          title="这是图形对象自带的符号，应当保留在底板位图里（⌥2）"
        >
          <ImageIcon aria-hidden="true" className="size-3.5" />
          对象符号
          <Kbd>⌥2</Kbd>
        </Button>
        {block.classification === "uncertain" && (
          <span className="text-2xs font-semibold text-proof">必须二选一</span>
        )}
      </div>
    </div>
  );
}
