import type { ReactNode } from "react";
import { useDeckStore } from "@/stores/deck-store";
import { useUIStore } from "@/stores/ui-store";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const name = useDeckStore((s) => s.name);
  const deckPath = useDeckStore((s) => s.deckPath);
  const currentView = useUIStore((s) => s.currentView);
  const setView = useUIStore((s) => s.setView);

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      {/* macOS hiddenInset 标题栏：整条顶栏作为窗口拖拽区域 */}
      <header
        className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-4 pt-8"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* 交互元素需退出拖拽区域，否则无法点击 */}
        <div
          className="flex items-center gap-3"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {deckPath && currentView === "slide" && (
            <button
              type="button"
              onClick={() => setView("deck")}
              className="rounded-sm border border-hairline px-2.5 py-1 text-xs text-ink transition hover:border-border-strong"
            >
              返回
            </button>
          )}
          <span className="text-sm font-medium text-ink">
            {name ?? "PPT Maker"}
          </span>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
