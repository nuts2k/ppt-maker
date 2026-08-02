import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useRunBridge } from "@/hooks/useRunBridge";
import { ConsolePage } from "@/pages/ConsolePage";
import { ReviewPage } from "@/pages/ReviewPage";
import { SourceReviewPage } from "@/pages/SourceReviewPage";
import { useSourceTaskStore } from "@/stores/source-task-store";
import { useUIStore } from "@/stores/ui-store";

export function App(): React.JSX.Element {
  const currentView = useUIStore((s) => s.currentView);
  const selectedSlideId = useUIStore((s) => s.selectedSlideId);

  // 执行事件订阅在应用根挂载一次，切到单页复核也不会中断批量执行的进度接收
  useRunBridge();

  /*
   * 建页任务的进度订阅同样挂在应用根，且**只挂一次**——它是
   * `deck:source-task-progress` 的唯一订阅点。
   *
   * 不挂的后果是静默的：任务照跑、结果照落盘，但界面一个进度事件都收不到，
   * 只会一直停在「执行中」不动，没有任何报错可循（`running` 靠 store.run 的
   * finally 兜底才落回 false，中间那段完全是黑的）。
   *
   * 挂在这里而不是 ConsolePage：审片视图里的「重新生成」也是建页任务，
   * 挂在控制台上就会随视图切换一起断掉。
   */
  useEffect(() => useSourceTaskStore.getState().subscribe(), []);

  return (
    <AppShell>
      {currentView === "slide" ? (
        // key 绑定页 id：换页即重挂载，视图态与临时提示自然回到初始值，
        // 不必在 ReviewPage 里写"切页重置"的 effect
        <ReviewPage key={selectedSlideId ?? "none"} />
      ) : currentView === "source-review" ? (
        // 审片视图**不绑 key**：换页要保留序列、说明草稿与滚动位置，
        // 逐张过一遍时每换一张就重挂载一次会让缩略图带全部重新加载
        <SourceReviewPage />
      ) : (
        <ConsolePage />
      )}
    </AppShell>
  );
}
