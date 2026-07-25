import { useEffect } from "react";
import { useActivityStore } from "@/stores/activity-store";
import { useDeckStore } from "@/stores/deck-store";
import { dispatchRunEvent } from "@/stores/run-bridge";
import { useRunStore } from "@/stores/run-store";

/**
 * 在应用根挂载执行事件订阅，并把事件扇出到 deck-store / activity-store。
 *
 * 只应挂载一次：run-store 是 `deck:run-progress` 的唯一订阅方，重复挂载会导致
 * 同一事件被重复计入活动日志。分发规则见 `stores/run-bridge.ts`（已单测）。
 */
export function useRunBridge(): void {
  useEffect(() => {
    const detach = useRunStore.getState().subscribe((event) => {
      const deck = useDeckStore.getState();
      const activity = useActivityStore.getState();

      dispatchRunEvent(event, {
        pageLabelOf: (slideId) => deck.getSlide(slideId)?.pageLabel ?? null,
        appendActivity: activity.append,
        refreshSlide: deck.refreshSlide,
        refreshDeck: deck.refreshStatus,
        reloadActivity: async () => {
          if (deck.deckPath === null) return;
          await activity.load(deck.deckPath);
        },
      });
    });

    return detach;
  }, []);
}
