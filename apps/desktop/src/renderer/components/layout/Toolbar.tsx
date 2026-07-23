import { cn } from "@/lib/utils";

interface ToolbarProps {
  deckName: string | null;
  currentView: "welcome" | "deck" | "slide";
  slideLabel?: string;
  dirty?: boolean;
  onBack?: () => void;
  onSave?: () => void;
}

export function Toolbar({
  deckName,
  currentView,
  slideLabel,
  dirty,
  onBack,
  onSave,
}: ToolbarProps): React.JSX.Element {
  return (
    <div className="flex h-12 shrink-0 items-center border-b border-hairline bg-canvas px-4">
      {/* macOS 红绿灯区域占位 */}
      <div className="w-16 shrink-0" />

      {currentView === "slide" && onBack && (
        <button
          type="button"
          className="mr-3 rounded-sm px-2 py-1 text-sm text-body hover:bg-surface-soft"
          onClick={onBack}
        >
          ← 返回
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {deckName && (
          <span className="truncate text-sm font-medium text-ink">
            {deckName}
          </span>
        )}
        {slideLabel && (
          <>
            <span className="text-muted">/</span>
            <span className="truncate text-sm text-body">{slideLabel}</span>
          </>
        )}
      </div>

      {currentView === "slide" && onSave && (
        <button
          type="button"
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm font-medium",
            dirty
              ? "bg-primary text-on-primary"
              : "bg-surface-strong text-muted",
          )}
          disabled={!dirty}
          onClick={onSave}
        >
          {dirty ? "保存" : "已保存"}
        </button>
      )}
    </div>
  );
}
