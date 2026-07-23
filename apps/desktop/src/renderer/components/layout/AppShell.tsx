import type { ReactNode } from "react";
import { useDeckStore } from "@/stores/deck-store";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const name = useDeckStore((s) => s.name);

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      {/* macOS hiddenInset 标题栏拖拽区域 */}
      <header
        className="flex h-11 shrink-0 items-end justify-center border-b border-hairline pb-2"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="text-xs font-medium text-muted">
          {name ?? "PPT Maker"}
        </span>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
