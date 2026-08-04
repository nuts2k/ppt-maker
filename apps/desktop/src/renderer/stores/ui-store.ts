import { create } from "zustand";
import { usePlanningStore } from "./planning-store.js";

/**
 * 视图路由：控制台、单页复核、源图审片三态。
 * V1 的 "welcome" 已取消——未打开 deck 时由 ConsolePage 的空态承担（design.md 3.3）。
 *
 * `source-review` 是 M5 ④ 新增的独立审片视图（E2）：判断一张生成图好不好，
 * 卡片缩略图那点尺寸根本不够，必须看大图。它是**第三个视图**而不是单页复核里
 * 的一档——停在源图确认的页还没跑 OCR，复核页后半屏全是空面板。
 */
type AppView = "console" | "slide" | "source-review" | "planning";

/**
 * 控制台卡片筛选口径。
 *
 * `todo` 的成员判定**一律取 `stores/todo-queue.ts` 的 `deriveTodoQueue`**，此处只存
 * 用户选了哪一档，不存页面集合——同一件事在两处各算一份迟早各说各话。
 *
 * 会话级，不写磁盘：不产生新的持久化状态，也就不可能与耐久层分歧。
 */
type ConsoleFilter = "all" | "todo";

/**
 * 来源选择模态的目标档：`new` 新建 deck、`append` 追加到当前 deck。
 *
 * 存**目标**而不是一个 `open: boolean`，是因为两个入口在同一时刻可能给出不同的
 * 目标：控制台的「添加页面」永远是追加，顶栏下拉的「新建 Deck…」在 deck 已打开
 * 时仍然是新建。只存布尔的话，目标就只能由「当前有没有 deck」反推，顶栏那条路
 * 会被反推成「追加」。
 */
type SourcePickerTarget = "new" | "append";

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
  /**
   * 来源选择模态的当前目标；null 表示未打开。
   *
   * 放在 ui-store 而不是 ConsolePage 的局部 state：触发它的两个入口分处两棵子树
   * （控制台的「添加页面」与顶栏下拉），局部 state 够不到顶栏。
   */
  sourcePicker: SourcePickerTarget | null;

  setView(view: AppView): void;
  selectSlide(slideId: string | null): void;
  selectBlock(blockId: string | null): void;
  /** 选中该页并切到单页复核视图（队列/卡片点击直达） */
  openSlide(slideId: string): void;
  /**
   * 切到源图审片视图（E2）。
   *
   * `slideId` 可省略：不给时由视图自己取待确认序列的第一项，用于「逐张确认」
   * 这类「从头开始过一遍」的入口；给了则直接定位到那一页（卡片直达、生成完成
   * 面板的「去确认」）。
   *
   * 这是本视图对外的唯一入口 action —— 生成完成面板等本文件之外的调用方一律
   * 调它，不要各自 `setView("source-review")` 再补一次 `selectSlide`。
   */
  openSourceReview(slideId?: string): void;
  /** 打开当前 deck 的规格工作台。 */
  openPlanning(): void;
  /** 从零新建策划；PlanningPage 负责建空 deck 后保持在本视图。 */
  openPlanningForNewDeck(): void;
  /** 返回控制台，保留当前选中页以便再次进入 */
  backToConsole(): void;
  toggleQueuePanel(open?: boolean): void;
  toggleActivityPanel(open?: boolean): void;
  toggleStageRail(open?: boolean): void;
  setConsoleFilter(filter: ConsoleFilter): void;
  openSourcePicker(target: SourcePickerTarget): void;
  closeSourcePicker(): void;
  /** 视图态整体归零（切换工作区），含三个面板的展开态、筛选档位与来源选择模态 */
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
  sourcePicker: null,
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

  openSourceReview(slideId) {
    set(
      slideId === undefined
        ? { currentView: "source-review", selectedBlockId: null }
        : {
            currentView: "source-review",
            selectedSlideId: slideId,
            selectedBlockId: null,
          },
    );
  },

  openPlanning() {
    set({ currentView: "planning", selectedBlockId: null });
  },

  openPlanningForNewDeck() {
    usePlanningStore.getState().prepareNewDeck();
    set({ currentView: "planning", selectedBlockId: null });
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

  openSourcePicker(target) {
    set({ sourcePicker: target });
  },

  closeSourcePicker() {
    set({ sourcePicker: null });
  },

  reset() {
    set({ ...INITIAL_STATE });
  },
}));

export type { AppView, ConsoleFilter, SourcePickerTarget, UIState };
