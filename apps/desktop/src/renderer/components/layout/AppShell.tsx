import type { ReactNode } from "react";
import { TopNav } from "./TopNav";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      {/* 拖拽区并入 TopNav 自身（见该组件），避免再叠一条 44px 空白标题栏 */}
      <TopNav />
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
