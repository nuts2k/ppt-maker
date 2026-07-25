import { useCallback, useEffect, useRef } from "react";

interface TextEditorProps {
  text: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

/**
 * 编辑框铺满识别框，字号与 TextBlockOverlay 的块内标注同为 10px——
 * 不一致会让双击进入编辑时文字突然跳大并溢出小块。10px 低于 DESIGN.md
 * 最小字号，属画布标注层的既定例外，不适用于界面排版。
 */
const EDITOR_CLASS =
  "absolute inset-0 resize-none border-none bg-canvas/90 p-1 text-[10px] text-ink outline-none focus:ring-1 focus:ring-info-border";

export function TextEditor({
  text,
  onCommit,
  onCancel,
}: TextEditorProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.stopPropagation();
        onCommit(ref.current?.value ?? text);
      }
    },
    [text, onCommit, onCancel],
  );

  const handleBlur = useCallback(() => {
    onCommit(ref.current?.value ?? text);
  }, [text, onCommit]);

  return (
    <textarea
      ref={ref}
      className={EDITOR_CLASS}
      defaultValue={text}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    />
  );
}
