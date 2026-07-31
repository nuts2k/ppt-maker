import { create } from "zustand";

/**
 * 视图路由：只有控制台与单页复核两态。
 * V1 的 "welcome" 已取消——未打开 deck 时由 ConsolePage 的空态承担（design.md 3.3）。
 */
type AppView = "console" | "slide";

/**
 * 控制台卡片筛选口径。
 *
 * `todo` 的成员判定**一律取 `stores/todo-queue.ts` 的 `deriveTodoQueue`**，此处只存
 * 用户选了哪一档，不存页面集合——同一件事在两处各算一份迟早各说各话。
 *
 * 会话级，不写磁盘：不产生新的持久化状态，也就不可能与耐久层分歧。
 */
type ConsoleFilter = "all" | "todo";

interface UIState {
  currentView: AppView;
  selectedSlideId: string | null;
  selectedBlockId: string | null;
  /** 控制台右侧待办队列 rail 是否展开；队列是主要驱动入口，默认展开 */
  queuePanelOpen: boolean;
  /** 底部活动日志抽屉是否展开；属于回溯用途，默认收起 */
  activityPanelOpen: boolean;
  /**
   * 单页复核的阶段轨道是否展开；**默认收起**。
   *
   * 用户进到单页时已经在做页内作业，9 个等权重点位提供的信息价值极低，
   * 而展开态要占 175px（复核页可视高度的 11%）。收起态用一条分段进度条
   * + 一句话状态承担扫读，异常阶段仍带形状与颜色标在条上；失败错误条
   * 不随收起消失——那是 M4 修过的关键能力，藏起来等于回退。
   */
  stageRailOpen: boolean;
  /**
   * 卡片网格筛选档位。默认只看待处理——一叠 20–50 页里绝大多数是完成态，
   * 默认铺满已完成页等于让用户每次都自己扫一遍。
   *
   * 「全部 / 待处理」切换在控制台常驻可见、不折叠不藏菜单，且筛选**只影响列表渲染**，
   * 不影响任何判据、导航或键盘遍历口径——否则「打开已完成页复看」这个能力会随
   * 默认筛选一起消失（见 .trellis/spec/frontend/state-management.md「一个判据兼职两件事」）。
   */
  consoleFilter: ConsoleFilter;

  setView(view: AppView): void;
  selectSlide(slideId: string | null): void;
  selectBlock(blockId: string | null): void;
  /** 选中该页并切到单页复核视图（队列/卡片点击直达） */
  openSlide(slideId: string): void;
  /** 返回控制台，保留当前选中页以便再次进入 */
  backToConsole(): void;
  toggleQueuePanel(open?: boolean): void;
  toggleActivityPanel(open?: boolean): void;
  toggleStageRail(open?: boolean): void;
  setConsoleFilter(filter: ConsoleFilter): void;
  /** 视图态整体归零（切换工作区），含三个面板的展开态与筛选档位 */
  reset(): void;
}

const INITIAL_STATE = {
  currentView: "console",
  selectedSlideId: null,
  selectedBlockId: null,
  queuePanelOpen: true,
  activityPanelOpen: false,
  stageRailOpen: false,
  consoleFilter: "todo",
} as const;

export const useUIStore = create<UIState>((set) => ({
  ...INITIAL_STATE,

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

  toggleStageRail(open) {
    set((state) => ({ stageRailOpen: open ?? !state.stageRailOpen }));
  },

  setConsoleFilter(filter) {
    set({ consoleFilter: filter });
  },

  reset() {
    set({ ...INITIAL_STATE });
  },
}));

export type { AppView, ConsoleFilter, UIState };
