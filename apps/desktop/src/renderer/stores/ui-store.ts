import { create } from "zustand";

/**
 * 视图路由：只有控制台与单页复核两态。
 * V1 的 "welcome" 已取消——未打开 deck 时由 ConsolePage 的空态承担（design.md 3.3）。
 */
type AppView = "console" | "slide";

interface UIState {
  currentView: AppView;
  selectedSlideId: string | null;
  selectedBlockId: string | null;
  /** 控制台右侧待办队列 rail 是否展开；队列是主要驱动入口，默认展开 */
  queuePanelOpen: boolean;
  /** 底部活动日志抽屉是否展开；属于回溯用途，默认收起 */
  activityPanelOpen: boolean;

  setView(view: AppView): void;
  selectSlide(slideId: string | null): void;
  selectBlock(blockId: string | null): void;
  /** 选中该页并切到单页复核视图（队列/卡片点击直达） */
  openSlide(slideId: string): void;
  /** 返回控制台，保留当前选中页以便再次进入 */
  backToConsole(): void;
  toggleQueuePanel(open?: boolean): void;
  toggleActivityPanel(open?: boolean): void;
}

export const useUIStore = create<UIState>((set) => ({
  currentView: "console",
  selectedSlideId: null,
  selectedBlockId: null,
  queuePanelOpen: true,
  activityPanelOpen: false,

  setView(view) {
    set({ currentView: view });
  },

  selectSlide(slideId) {
    set({ selectedSlideId: slideId, selectedBlockId: null });
  },

  selectBlock(blockId) {
    set({ selectedBlockId: blockId });
  },

  openSlide(slideId) {
    set({
      currentView: "slide",
      selectedSlideId: slideId,
      selectedBlockId: null,
    });
  },

  backToConsole() {
    set({ currentView: "console", selectedBlockId: null });
  },

  toggleQueuePanel(open) {
    set((state) => ({ queuePanelOpen: open ?? !state.queuePanelOpen }));
  },

  toggleActivityPanel(open) {
    set((state) => ({ activityPanelOpen: open ?? !state.activityPanelOpen }));
  },
}));

export type { AppView, UIState };
