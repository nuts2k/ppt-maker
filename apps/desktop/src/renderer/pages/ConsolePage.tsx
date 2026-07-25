import { useEffect, useMemo } from "react";
import { ActivityPanel } from "@/components/console/ActivityPanel";
import { DeckEmptyState } from "@/components/console/DeckEmptyState";
import { RunControlBar } from "@/components/console/RunControlBar";
import { SlideCardGrid } from "@/components/console/SlideCardGrid";
import { TodoQueuePanel } from "@/components/console/TodoQueuePanel";
import { useActivityStore } from "@/stores/activity-store";
import { useDeckStore } from "@/stores/deck-store";

/**
 * 控制台 —— 批量优先的主视图（design.md 3.3）。
 *
 * 三个区域各自从 store 取数，本页只负责布局与两件跨组件的事：
 * 1. deck 切换时拉取活动日志（面板组件本身不发 IPC，避免折叠/展开触发重复请求）；
 * 2. 页面级次要操作（添加页面 / 刷新）——执行相关操作一律归 RunControlBar，
 *    导出归 TopNav，此处只放不影响流水线状态的工具动作。
 */
export function ConsolePage(): React.JSX.Element {
  const deckPath = useDeckStore((s) => s.deckPath);
  const slides = useDeckStore((s) => s.slides);
  const loading = useDeckStore((s) => s.loading);
  const error = useDeckStore((s) => s.error);
  const addSlide = useDeckStore((s) => s.addSlide);
  const refreshStatus = useDeckStore((s) => s.refreshStatus);
  const loadActivity = useActivityStore((s) => s.load);
  const resetActivity = useActivityStore((s) => s.reset);

  // 活动日志随 deck 切换整体重载；run-done 后的覆盖式刷新由 run-bridge 负责
  useEffect(() => {
    if (deckPath === null) {
      resetActivity();
      return;
    }
    void loadActivity(deckPath).catch(() => {
      // 日志缺失不应阻断控制台使用，错误已记入 activity-store
    });
  }, [deckPath, loadActivity, resetActivity]);

  const activeCount = useMemo(
    () => slides.filter((slide) => !slide.removed).length,
    [slides],
  );

  async function handleAddSlide(): Promise<void> {
    if (deckPath === null) return;
    const imagePath = await window.api.system.selectFile([
      { name: "图片", extensions: ["png", "jpg", "jpeg"] },
    ]);
    if (imagePath === null) return;
    await addSlide(imagePath).catch(() => {
      // 失败信息已写入 deck-store.error，由下方错误条呈现
    });
  }

  if (deckPath === null) {
    return <DeckEmptyState />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-6 pt-6">
            <RunControlBar />
          </div>

          {error !== null && (
            <p className="mx-6 mt-4 rounded-sm bg-signature-coral/10 px-4 py-2 text-sm font-medium text-signature-coral">
              {error}
            </p>
          )}

          <div className="flex shrink-0 items-center justify-between px-6 pb-2 pt-6">
            <h2 className="text-base font-medium text-ink">
              页面
              <span className="ml-2 text-sm font-medium text-muted">
                {activeCount}
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void refreshStatus()}
                disabled={loading}
                className="rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink transition active:border-border-strong disabled:opacity-40"
              >
                刷新
              </button>
              <button
                type="button"
                onClick={() => void handleAddSlide()}
                disabled={loading}
                className="rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink transition active:border-border-strong disabled:opacity-40"
              >
                添加页面
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <SlideCardGrid />
          </div>
        </div>

        <TodoQueuePanel />
      </div>

      <ActivityPanel />
    </div>
  );
}
