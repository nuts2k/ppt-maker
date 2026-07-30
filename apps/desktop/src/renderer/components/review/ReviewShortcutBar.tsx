import { cn } from "@/lib/utils";

/**
 * 复核快捷键条（design.md §4.1 ReviewShortcutBar）。
 *
 * 常驻可见而非 tooltip：PRD 验收要求「全程仅用键盘即可完成一页复核」，
 * 藏在悬停里的键位等于不存在——F-6 记录的真实使用行为是「打开 → 全部标记已复核 →
 * 跑下去」，从未有人发现界面里的交互能力。
 */

interface ReviewShortcutBarProps {
  readonly className?: string;
}

const SHORTCUTS: ReadonlyArray<{
  readonly keys: string;
  readonly hint: string;
}> = [
  { keys: "Tab / ↓", hint: "下一项" },
  { keys: "⇧Tab / ↑", hint: "上一项" },
  { keys: "直接打字", hint: "编辑当前项文字" },
  { keys: "⇧Enter", hint: "换行" },
  { keys: "Enter", hint: "标记已复核并前进" },
  { keys: "⌘↓", hint: "下一个未复核项" },
  { keys: "⌥1", hint: "改为版式文字" },
  { keys: "⌥2", hint: "改为对象符号" },
  { keys: "⌘S", hint: "保存" },
];

export function ReviewShortcutBar({
  className,
}: ReviewShortcutBarProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline bg-canvas px-6 py-2",
        className,
      )}
    >
      {SHORTCUTS.map((shortcut) => (
        <span
          key={shortcut.keys}
          className="flex items-center gap-1.5 text-sm font-medium tracking-[0.16px] text-muted"
        >
          <kbd className="rounded-xs bg-surface-strong px-1.5 py-0.5 font-sans text-sm text-ink">
            {shortcut.keys}
          </kbd>
          {shortcut.hint}
        </span>
      ))}
    </div>
  );
}
