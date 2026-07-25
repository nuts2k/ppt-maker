import { AppShell } from "@/components/layout/AppShell";
import { useRunBridge } from "@/hooks/useRunBridge";
import { ConsolePage } from "@/pages/ConsolePage";
import { SlidePage } from "@/pages/SlidePage";
import { useUIStore } from "@/stores/ui-store";

export function App(): React.JSX.Element {
  const currentView = useUIStore((s) => s.currentView);
  const selectedSlideId = useUIStore((s) => s.selectedSlideId);

  // 执行事件订阅在应用根挂载一次，切到单页复核也不会中断批量执行的进度接收
  useRunBridge();

  return (
    <AppShell>
      {currentView === "slide" ? (
        // key 绑定页 id：换页即重挂载，视图态/侧边栏页签/临时提示自然回到初始值，
        // 不必在 SlidePage 里写"切页重置"的 effect
        <SlidePage key={selectedSlideId ?? "none"} />
      ) : (
        <ConsolePage />
      )}
    </AppShell>
  );
}
