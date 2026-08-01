import { Keyboard, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton, Kbd, Panel } from "@/components/ui";
import { resolveShortcutPanelKey } from "@/lib/review-keyboard";
import { cn } from "@/lib/utils";

/**
 * 复核快捷键 —— 一条 30px 的窄条 + 按需唤起的完整键位面板。
 *
 * 常驻九条键位曾占 110px。PRD 验收要求「全程仅用键盘即可完成一页复核」，所以
 * 键位**不能只藏进悬停**——F-6 记录的真实使用行为是「打开 → 全部标记已复核 →
 * 跑下去」，从未有人发现界面里的交互能力。但「不能只藏」不等于「必须全部常驻」：
 *
 * - 窄条上留一个可见入口（图标 + 文字 + `?` 键提示）与最常用的三条键位摘要，
 *   发现性由它承担；
 * - 完整九条收进面板，`?` 唤起、Esc 或再按 `?` 收起，点击外部亦收起。
 *
 * 入口必须是可见控件而非纯隐藏键：只有隐藏快捷键等于能力静默消失，
 * 见 .trellis/spec/guides/silent-failure-thinking-guide.md 的「入口长在会消失的容器里」。
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
  { keys: "? / ⌘/", hint: "开关本面板" },
];

const PANEL_ID = "review-shortcut-panel";

/**
 * 正在输入文字时 `?` 是内容而不是命令。
 *
 * 这条判断本身是对的，但它曾让「求助」在可编辑行里完全键盘不可达：块列表的
 * 「文字待确认」档常驻 textarea，焦点在那里时 `?` 不拦截、唯一入口只剩鼠标。
 * 出口是下面的 `⌘/` —— 带修饰键，在输入框里不会与内容冲突，故不受此限制。
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function ReviewShortcutBar({
  className,
}: ReviewShortcutBarProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const action = resolveShortcutPanelKey({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        isTyping: isTypingTarget(event.target),
      });
      if (action === "ignore") return;
      if (action === "close") {
        setOpen(false);
        return;
      }
      event.preventDefault();
      setOpen((value) => !value);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 从键盘唤起却把焦点留在原处，等于打开了一个键盘用户够不到的东西
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  // 点击面板外部收起（与顶栏下拉同一套行为）
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent): void {
      const node = rootRef.current;
      if (node && !node.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex shrink-0 items-center gap-3 border-t border-hairline bg-canvas px-6 py-1",
        className,
      )}
    >
      <Button
        size="sm"
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen((value) => !value)}
      >
        <Keyboard aria-hidden="true" className="size-3.5" />
        键盘快捷键
        <Kbd>?</Kbd>
      </Button>

      {/* 最常用的三条留在条上：面板收着时也要有东西可看，否则入口等于一句空话 */}
      <p className="min-w-0 flex-1 truncate text-2xs text-ink-muted">
        Tab / ↓ 切换项 · Enter 标记已复核并前进 · ⌘S 保存
      </p>

      {open && (
        <Panel
          id={PANEL_ID}
          role="dialog"
          aria-label="键盘快捷键"
          elevation="raised"
          className="absolute bottom-full left-6 z-20 mb-2 w-[440px] p-3"
        >
          <div className="flex items-center gap-2 pb-2">
            <h2 className="min-w-0 flex-1 text-sm font-semibold text-ink">
              键盘快捷键
            </h2>
            <IconButton
              ref={closeRef}
              size="sm"
              variant="ghost"
              label="关闭快捷键面板"
              onClick={() => setOpen(false)}
            >
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
            {SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.keys}
                className="flex items-center gap-2 text-sm text-ink-secondary"
              >
                {/* 独立成项，没有按钮外壳兜着，所以这里用带框的 cap 档 */}
                <Kbd variant="cap">{shortcut.keys}</Kbd>
                <span className="min-w-0 flex-1 truncate">{shortcut.hint}</span>
              </li>
            ))}
          </ul>
          {/* 正在编辑文字时 ? 是内容不是命令，这里必须一并说出 ⌘/，否则提示对半数场景是错的 */}
          <p className="pt-2 text-2xs text-ink-muted">
            按 Esc 收起；编辑文字时用 ⌘/ 开关
          </p>
        </Panel>
      )}
    </div>
  );
}
