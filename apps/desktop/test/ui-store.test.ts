/**
 * ui-store 的视图态归零测试（PRD R2 / AC4）。
 *
 * ui-store 不经 window 也不用 `@/` 别名，可直接在 node 环境驱动真实 store。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "../src/renderer/stores/ui-store.js";

beforeEach(() => {
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

  it("两个面板的展开态回默认（队列展开、活动日志收起）", () => {
    useUIStore.getState().toggleQueuePanel(false);
    useUIStore.getState().toggleActivityPanel(true);

    useUIStore.getState().reset();

    expect(useUIStore.getState().queuePanelOpen).toBe(true);
    expect(useUIStore.getState().activityPanelOpen).toBe(false);
  });

  it("归零后仍可正常选页（action 未被覆盖）", () => {
    useUIStore.getState().reset();
    useUIStore.getState().openSlide("slide-1");
    expect(useUIStore.getState().currentView).toBe("slide");
    expect(useUIStore.getState().selectedSlideId).toBe("slide-1");
  });
});
