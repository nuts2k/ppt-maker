/**
 * 切换工作区的编排测试（PRD R2 R3 / AC3 AC4 AC5）。
 *
 * deck / run / slide / activity 四个 store 都经 window 或 `@/` 别名，把它们拉进
 * test 的类型图会让 tsconfig.node.json 解析失败（同 slide-store-edit.test.ts 的取舍），
 * 因此这里用形状一致的替身，并复刻 deck-store「失败只写 error、不动 deckPath/slides」
 * 的真实语义；ui-store 不碰 window，直接用真实 store。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  applyWorkspaceSwitch,
  type WorkspaceSwitchDeps,
  workspacePathForImages,
} from "../src/renderer/lib/workspace-switch-core.js";
import { useUIStore } from "../src/renderer/stores/ui-store.js";

const TODAY = "2026-07-30";
const OPEN_FAILURE = "不是合法的 Deck 工作区";

interface Harness {
  readonly deck: {
    deckPath: string | null;
    slides: readonly string[];
    error: string | null;
  };
  readonly run: { liveStages: Record<string, string> };
  readonly slide: { slideId: string | null; dirty: boolean };
  readonly activity: { records: readonly string[] };
  /** 调用轨迹，用于断言「先打开成功、再清零」的顺序 */
  readonly trace: string[];
  readonly createdPaths: string[];
  readonly deps: WorkspaceSwitchDeps;
}

/** 造一个「已打开旧 deck 且各层都有残留」的现场；`fail` 时打开/创建一律失败 */
function createHarness(fail = false): Harness {
  const deck = {
    deckPath: "/decks/old" as string | null,
    slides: ["old-1", "old-2"] as readonly string[],
    error: null as string | null,
  };
  const run = {
    liveStages: { "old-1": "completed" } as Record<string, string>,
  };
  const slide = { slideId: "old-1" as string | null, dirty: true };
  const activity = { records: ["旧 deck 的日志"] as readonly string[] };
  const trace: string[] = [];
  const createdPaths: string[] = [];

  useUIStore.getState().openSlide("old-1");
  useUIStore.getState().selectBlock("block-9");

  function applyOpened(path: string): void {
    deck.deckPath = path;
    deck.slides = ["new-1"];
    deck.error = null;
  }

  function rejectOpen(): never {
    deck.error = OPEN_FAILURE;
    throw new Error(OPEN_FAILURE);
  }

  const deps: WorkspaceSwitchDeps = {
    async openDeck(path) {
      trace.push("open");
      if (fail) rejectOpen();
      applyOpened(path);
    },

    async createDeck(_imagesDir, workspacePath) {
      trace.push("create");
      createdPaths.push(workspacePath);
      if (fail) rejectOpen();
      applyOpened(workspacePath);
    },

    resetOtherStores() {
      trace.push("reset");
      run.liveStages = {};
      slide.slideId = null;
      slide.dirty = false;
      activity.records = [];
      useUIStore.getState().reset();
    },
  };

  return { deck, run, slide, activity, trace, createdPaths, deps };
}

function expectClean(h: Harness): void {
  expect(h.run.liveStages).toEqual({});
  expect(h.slide.slideId).toBeNull();
  expect(h.slide.dirty).toBe(false);
  expect(h.activity.records).toEqual([]);
  expect(useUIStore.getState().selectedSlideId).toBeNull();
}

function expectUntouched(h: Harness): void {
  expect(h.run.liveStages).toEqual({ "old-1": "completed" });
  expect(h.slide.slideId).toBe("old-1");
  expect(h.slide.dirty).toBe(true);
  expect(h.activity.records).toEqual(["旧 deck 的日志"]);
  expect(useUIStore.getState().selectedSlideId).toBe("old-1");
}

beforeEach(() => {
  useUIStore.getState().reset();
});

describe("workspacePathForImages", () => {
  it("工作区建在图片目录同级、目录名带日期后缀", () => {
    expect(workspacePathForImages("/Users/me/shots", TODAY)).toBe(
      "/Users/me/shots-2026-07-30",
    );
  });

  it("同一图片目录在不同日期落到不同工作区，重复创建不互相覆盖", () => {
    expect(workspacePathForImages("/Users/me/shots", "2026-07-31")).not.toBe(
      workspacePathForImages("/Users/me/shots", TODAY),
    );
  });
});

describe("applyWorkspaceSwitch · 打开已有工作区", () => {
  it("成功后四个 store 归零、deck 换成新的", async () => {
    const h = createHarness();
    await applyWorkspaceSwitch(h.deps, { kind: "open", path: "/decks/new" });

    expect(h.deck.deckPath).toBe("/decks/new");
    expect(h.deck.slides).toEqual(["new-1"]);
    expectClean(h);
  });

  it("清零发生在打开成功之后（顺序写反会在选错目录时丢掉当前 deck）", async () => {
    const h = createHarness();
    await applyWorkspaceSwitch(h.deps, { kind: "open", path: "/decks/new" });
    expect(h.trace).toEqual(["open", "reset"]);
  });

  it("切换前处于单页复核视图时，切换后回到控制台且选中块为空", async () => {
    const h = createHarness();
    expect(useUIStore.getState().currentView).toBe("slide");

    await applyWorkspaceSwitch(h.deps, { kind: "open", path: "/decks/new" });

    expect(useUIStore.getState().currentView).toBe("console");
    expect(useUIStore.getState().selectedBlockId).toBeNull();
  });

  it("打开失败时四个 store 一个都没清，当前 deck 完好，错误已由 deck-store 承载", async () => {
    const h = createHarness(true);

    await expect(
      applyWorkspaceSwitch(h.deps, { kind: "open", path: "/tmp/not-a-deck" }),
    ).rejects.toThrow(OPEN_FAILURE);

    expect(h.deck.deckPath).toBe("/decks/old");
    expect(h.deck.slides).toEqual(["old-1", "old-2"]);
    expect(h.deck.error).toBe(OPEN_FAILURE);
    expect(h.trace).toEqual(["open"]);
    expectUntouched(h);
  });
});

describe("applyWorkspaceSwitch · 从图片目录创建", () => {
  it("按命名规则算出工作区路径，成功后同样清零", async () => {
    const h = createHarness();
    await applyWorkspaceSwitch(
      h.deps,
      { kind: "create", imagesDir: "/Users/me/shots" },
      TODAY,
    );

    expect(h.createdPaths).toEqual(["/Users/me/shots-2026-07-30"]);
    expect(h.deck.deckPath).toBe("/Users/me/shots-2026-07-30");
    expectClean(h);
  });

  it("创建失败时同样不清任何 store", async () => {
    const h = createHarness(true);

    await expect(
      applyWorkspaceSwitch(
        h.deps,
        { kind: "create", imagesDir: "/Users/me/shots" },
        TODAY,
      ),
    ).rejects.toThrow(OPEN_FAILURE);

    expect(h.deck.deckPath).toBe("/decks/old");
    expect(h.trace).toEqual(["create"]);
    expectUntouched(h);
  });
});
