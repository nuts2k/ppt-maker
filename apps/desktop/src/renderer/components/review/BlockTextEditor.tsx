import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useEffect, useRef } from "react";
import { Textarea } from "@/components/ui";

/**
 * 块文本编辑框 —— 三个分区里**所有**改文本入口共用的唯一实现。
 *
 * 「文字待确认」（双源分歧，当前项常驻可编辑）与「已一致」（双源一致，点击才转
 * 编辑态）改的是同一件事：`block.text` 与派生的 `block.lines`。两处各写一份
 * textarea 与切行逻辑必然分叉——切行口径（按换行切、去空行、全空则整段当单行）
 * 与 core 的 `splitLines` 一致，而 core 未导出它，多一份副本就多一处会漂移的地方。
 *
 * 焦点行为也收在这里：挂载即聚焦并把光标置于末尾（「直接打字即编辑」）。
 */

interface BlockTextEditorProps {
  readonly block: TextReviewBlock;
  readonly onUpdateBlock: (
    blockId: string,
    patch: Partial<TextReviewBlock>,
  ) => void;
  /** 挂载时自动聚焦；「文字待确认」由 isCurrent 决定，「已一致」进编辑态即为 true */
  readonly autoFocus: boolean;
  /**
   * 退出编辑态。传了才启用 Esc / 失焦退出——「文字待确认」档常驻可编辑，
   * 没有可退回的只读态，不传即保持原行为。
   */
  readonly onExit?: () => void;
}

export function BlockTextEditor({
  block,
  onUpdateBlock,
  autoFocus,
  onExit,
}: BlockTextEditorProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const node = textareaRef.current;
    if (node === null) return;
    node.focus();
    const end = node.value.length;
    node.setSelectionRange(end, end);
  }, [autoFocus]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = event.target.value;
      // 与 core 的 splitLines 同口径：按换行切分、去空行；全空则整段当作单行
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      onUpdateBlock(block.id, {
        text,
        lines: lines.length > 0 ? lines : [text],
      });
    },
    [block.id, onUpdateBlock],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (onExit === undefined || event.key !== "Escape") return;
      // 组字期间的 Esc 属于输入法（取消候选），不该顺手退出编辑态
      if (event.nativeEvent.isComposing) return;
      event.stopPropagation();
      textareaRef.current?.blur();
    },
    [onExit],
  );

  return (
    // 边框、占位符、hover 与禁用态一律走基座 Field；焦点环由 index.css 全局提供，
    // 此处不再自拼 `focus:border-*`（旧写法用的还是营销站派生的 info 令牌）。
    <Textarea
      ref={textareaRef}
      value={block.text}
      onChange={handleChange}
      onBlur={onExit}
      onKeyDown={handleKeyDown}
      rows={Math.min(4, Math.max(1, block.lines.length))}
      /**
       * `field-sizing: content` 让高度跟着**换行后的实际行数**走。
       *
       * `rows` 取的是源数据行数（`block.lines.length`），而不是渲染宽度下的换行数。
       * 左栏比整屏窄，一行源文本经常折成两行，于是 rows=1 只给到 1.5 行高度，
       * 第二行被从字形中间切断——与最终确认页 8.2 修的是同一类缺陷：容器把内容切了，
       * 而不是内容自己该省略。滚动条虽在，但要用户先发现「这里还有半行」才会去滚。
       *
       * 上限 4 行后转滚动，与 `rows` 的上限一致；`resize-y` 保留，用户仍可手动拉大。
       */
      className="min-w-0 resize-y py-1.5 [field-sizing:content] max-h-[7.5rem]"
    />
  );
}
