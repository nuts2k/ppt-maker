import { AppShell } from "@/components/layout/AppShell";
import { DeckPage } from "@/pages/DeckPage";
import { SlidePage } from "@/pages/SlidePage";
import { useUIStore } from "@/stores/ui-store";

export function App(): React.JSX.Element {
  const currentView = useUIStore((s) => s.currentView);

  return (
    <AppShell>
      {currentView === "slide" ? <SlidePage /> : <DeckPage />}
    </AppShell>
  );
}
