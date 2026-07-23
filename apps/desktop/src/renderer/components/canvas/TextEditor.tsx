import { useCallback, useEffect, useRef } from "react";

interface TextEditorProps {
  text: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

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
      className="absolute inset-0 resize-none border-none bg-canvas/90 p-1 text-xs text-ink outline-none focus:ring-1 focus:ring-info-border"
      defaultValue={text}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    />
  );
}
