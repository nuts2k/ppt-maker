import { AppShell } from "@/components/layout/AppShell";
import { useRunBridge } from "@/hooks/useRunBridge";
import { ConsolePage } from "@/pages/ConsolePage";
import { SlidePage } from "@/pages/SlidePage";
import { useUIStore } from "@/stores/ui-store";

export function App(): React.JSX.Element {
  const currentView = useUIStore((s) => s.currentView);

  // 执行事件订阅在应用根挂载一次，切到单页复核也不会中断批量执行的进度接收
  useRunBridge();

  return (
    <AppShell>
      {currentView === "slide" ? <SlidePage /> : <ConsolePage />}
    </AppShell>
  );
}
