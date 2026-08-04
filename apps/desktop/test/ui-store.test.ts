/**
 * ui-store 的视图态归零测试（PRD R2 / AC4）。
 *
 * ui-store 不经 window 也不用 `@/` 别名，可直接在 node 环境驱动真实 store。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { usePlanningConversationStore } from "../src/renderer/stores/planning-conversation-store.js";
import { usePlanningStore } from "../src/renderer/stores/planning-store.js";
import { useUIStore } from "../src/renderer/stores/ui-store.js";

beforeEach(() => {
  usePlanningStore.getState().reset();
  usePlanningConversationStore.getState().reset();
  useUIStore.getState().reset();
});

describe("useUIStore.reset", () => {
  it("视图回控制台，选中页与选中块清空", () => {
    useUIStore.getState().openSlide("slide-3");
    useUIStore.getState().selectBlock("block-7");

    useUIStore.getState().reset();

    const state = useUIStore.getState();
    expect(state.currentView).toBe("console");
    expect(state.selectedSlideId).toBeNull();
    expect(state.selectedBlockId).toBeNull();
  });

  it("三个面板的展开态回默认（队列展开、活动日志与阶段轨道收起）", () => {
    useUIStore.getState().toggleQueuePanel(false);
    useUIStore.getState().toggleActivityPanel(true);
    useUIStore.getState().toggleStageRail(true);

    useUIStore.getState().reset();

    expect(useUIStore.getState().queuePanelOpen).toBe(true);
    expect(useUIStore.getState().activityPanelOpen).toBe(false);
    expect(useUIStore.getState().stageRailOpen).toBe(false);
  });

  it("控制台筛选回默认（只看待处理）", () => {
    useUIStore.getState().setConsoleFilter("all");
    expect(useUIStore.getState().consoleFilter).toBe("all");

    useUIStore.getState().reset();

    expect(useUIStore.getState().consoleFilter).toBe("todo");
  });

  /**
   * 筛选只影响控制台列表渲染，不得顺手改动选中页或视图——否则「打开已完成页复看」
   * 会随筛选一起消失（见 .trellis/spec/frontend/state-management.md「一个判据兼职两件事」）。
   */
  it("切筛选不影响当前视图与选中页", () => {
    useUIStore.getState().openSlide("slide-9");

    useUIStore.getState().setConsoleFilter("all");
    useUIStore.getState().setConsoleFilter("todo");

    expect(useUIStore.getState().currentView).toBe("slide");
    expect(useUIStore.getState().selectedSlideId).toBe("slide-9");
  });

  /**
   * 第三个视图（源图审片）必须一并被归零覆盖：切换工作区靠的就是这一次 reset，
   * 漏掉它会在新 deck 里停在上一个 deck 的审片视图上（`switchWorkspace` 只调
   * `useUIStore.reset()`，不逐字段清）。
   */
  it("从审片视图归零同样回控制台", () => {
    useUIStore.getState().openSourceReview("slide-5");
    expect(useUIStore.getState().currentView).toBe("source-review");

    useUIStore.getState().reset();

    expect(useUIStore.getState().currentView).toBe("console");
    expect(useUIStore.getState().selectedSlideId).toBeNull();
  });

  it("从策划视图归零同样回控制台", () => {
    useUIStore.getState().openPlanning();
    expect(useUIStore.getState().currentView).toBe("planning");

    useUIStore.getState().reset();

    expect(useUIStore.getState().currentView).toBe("console");
    expect(useUIStore.getState().selectedSlideId).toBeNull();
  });

  /**
   * 来源选择模态的开关也在 ui-store（顶栏与控制台两个入口共用），因此同样要被
   * reset 覆盖：切换工作区时若还开着，模态里的目标 deck 就是上一个工作区的。
   */
  it("来源选择模态归零关闭", () => {
    useUIStore.getState().openSourcePicker("append");
    expect(useUIStore.getState().sourcePicker).toBe("append");

    useUIStore.getState().reset();

    expect(useUIStore.getState().sourcePicker).toBeNull();
  });

  it("模态目标存的是入口给的档，不由当前是否有 deck 反推", () => {
    useUIStore.getState().openSourcePicker("new");
    expect(useUIStore.getState().sourcePicker).toBe("new");

    useUIStore.getState().closeSourcePicker();
    expect(useUIStore.getState().sourcePicker).toBeNull();
  });

  it("归零后仍可正常选页（action 未被覆盖）", () => {
    useUIStore.getState().reset();
    useUIStore.getState().openSlide("slide-1");
    expect(useUIStore.getState().currentView).toBe("slide");
    expect(useUIStore.getState().selectedSlideId).toBe("slide-1");
  });
});

describe("useUIStore planning actions", () => {
  it("已有 deck 入口切到策划视图并清掉选中块", () => {
    useUIStore.getState().openSlide("slide-3");
    useUIStore.getState().selectBlock("block-7");

    useUIStore.getState().openPlanning();

    const state = useUIStore.getState();
    expect(state.currentView).toBe("planning");
    expect(state.selectedSlideId).toBe("slide-3");
    expect(state.selectedBlockId).toBeNull();
  });

  it("新建策划入口进入同一策划视图并清掉选中块", () => {
    useUIStore.getState().openSlide("slide-4");
    useUIStore.getState().selectBlock("block-8");

    useUIStore.getState().openPlanningForNewDeck();

    const state = useUIStore.getState();
    expect(state.currentView).toBe("planning");
    expect(state.selectedSlideId).toBe("slide-4");
    expect(state.selectedBlockId).toBeNull();
    expect(usePlanningStore.getState().justCreated).toBe(true);
    expect(usePlanningStore.getState().loadedDeckPath).toBeNull();
    expect(usePlanningConversationStore.getState().deckPath).toBeNull();
    expect(usePlanningConversationStore.getState().snapshot).toBeNull();
  });
});

/**
 * 源图审片视图的入口 action（design.md §5.4）。
 *
 * 三个入口共用它：待办队列组标题的「逐张确认」（不带页，从第一个待确认开始）、
 * 生成完成面板的「去确认」与卡片直达（带页）。各自 `setView` 再补一次
 * `selectSlide` 迟早会漏掉一处。
 */
describe("useUIStore.openSourceReview", () => {
  it("不带页：只切视图，选中页保持不动（由视图落到第一个待确认）", () => {
    useUIStore.getState().selectSlide("slide-2");

    useUIStore.getState().openSourceReview();

    expect(useUIStore.getState().currentView).toBe("source-review");
    expect(useUIStore.getState().selectedSlideId).toBe("slide-2");
  });

  it("带页：切视图并定位到该页", () => {
    useUIStore.getState().openSourceReview("slide-7");

    expect(useUIStore.getState().currentView).toBe("source-review");
    expect(useUIStore.getState().selectedSlideId).toBe("slide-7");
  });

  it("进出审片视图不残留选中块", () => {
    useUIStore.getState().openSlide("slide-1");
    useUIStore.getState().selectBlock("block-3");

    useUIStore.getState().openSourceReview("slide-1");

    expect(useUIStore.getState().selectedBlockId).toBeNull();
  });

  it("返回控制台后可再次进入（视图态非单向）", () => {
    useUIStore.getState().openSourceReview("slide-4");
    useUIStore.getState().backToConsole();
    expect(useUIStore.getState().currentView).toBe("console");

    useUIStore.getState().openSourceReview("slide-4");
    expect(useUIStore.getState().currentView).toBe("source-review");
  });
});

/**
 * 阶段轨道展开态（design.md §5）。
 *
 * **默认收起**：用户进到单页时已经在做页内作业，9 个等权重点位的信息价值极低，
 * 而展开态要占 175px。收起态用一条分段进度条 + 一句话状态承担扫读。
 */
describe("useUIStore.toggleStageRail", () => {
  it("默认收起", () => {
    expect(useUIStore.getState().stageRailOpen).toBe(false);
  });

  it("不传参取反", () => {
    useUIStore.getState().toggleStageRail();
    expect(useUIStore.getState().stageRailOpen).toBe(true);

    useUIStore.getState().toggleStageRail();
    expect(useUIStore.getState().stageRailOpen).toBe(false);
  });

  it("显式传参按参数落定，重复调用幂等", () => {
    useUIStore.getState().toggleStageRail(true);
    useUIStore.getState().toggleStageRail(true);
    expect(useUIStore.getState().stageRailOpen).toBe(true);

    useUIStore.getState().toggleStageRail(false);
    useUIStore.getState().toggleStageRail(false);
    expect(useUIStore.getState().stageRailOpen).toBe(false);
  });

  /**
   * 展开态是会话级视图态，不得顺手改动选中页或视图——与筛选同理，
   * 见 .trellis/spec/frontend/state-management.md「一个判据兼职两件事」。
   */
  it("展开收起不影响当前视图与选中页", () => {
    useUIStore.getState().openSlide("slide-4");

    useUIStore.getState().toggleStageRail(true);
    useUIStore.getState().toggleStageRail(false);

    expect(useUIStore.getState().currentView).toBe("slide");
    expect(useUIStore.getState().selectedSlideId).toBe("slide-4");
  });
});
