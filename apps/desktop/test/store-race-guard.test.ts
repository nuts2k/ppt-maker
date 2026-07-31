/**
 * 「迟到的响应不得写入 store」的时序回归（切换工作区的连带缺陷）。
 *
 * 在切换能力落地之前 deckPath 一辈子不变，这条路径几乎不可触发；能切之后，
 * 旧 deck 的在途请求就会在切换完成后才落地，无条件 set 会把上一个 deck 的数据
 * 静默贴进新 deck 的界面（state-management.md 第一条那个模式）。
 *
 * 每条用例都复现完整时序：**发出请求 → 期间切换/切页 → 迟到的响应到达**，
 * 并断言 store 的最终状态未被污染——只断言判据函数的返回值覆盖不到这个缺陷。
 * 每处守卫都配一条正对照（不切换时结果必须照常写入），否则守卫写成恒真也能过。
 */

import type { TextReviewDocument } from "@ppt-maker/core";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ActivityRecord,
  DeckStatusDetailedResult,
  IpcApi,
  SlideDetail,
} from "../src/main/ipc/channels.js";
import { useActivityStore } from "../src/renderer/stores/activity-store.js";
import { useDeckStore } from "../src/renderer/stores/deck-store.js";
import { useSlideStore } from "../src/renderer/stores/slide-store.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(err: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 只桩出被测方法；其余成员不会被触碰，因此整体转型即可 */
function stubApi(api: unknown): void {
  globalThis.window = { api: api as IpcApi };
}

function slide(slideId: string, pageLabel = slideId): SlideDetail {
  return {
    slideId,
    workspacePath: `slides/${slideId}`,
    sourceImageName: `${slideId}.png`,
    currentStage: "ocr",
    stageStatus: "completed",
    removed: false,
    absWorkspacePath: `/decks/old/slides/${slideId}`,
    pageLabel,
    stages: [{ stage: "ocr", status: "completed" }],
    lastError: null,
    stageDurations: { ocr: 1200 },
    pendingTextReview: 0,
  };
}

const SUMMARY: DeckStatusDetailedResult["summary"] = {
  total: 1,
  active: 1,
  removed: 0,
  completed: 0,
  inProgress: 1,
  notStarted: 0,
};

function detailed(
  deckPath: string,
  slides: readonly SlideDetail[],
): DeckStatusDetailedResult {
  return {
    deckPath,
    name: deckPath.split("/").pop() ?? "deck",
    deckId: `id-${deckPath}`,
    slides: [...slides],
    // 每次返回独立对象，摘要是否被旧结果盖掉可用引用比对判断
    summary: { ...SUMMARY },
  };
}

function reviewDoc(slideId: string): TextReviewDocument {
  return {
    schemaVersion: 1,
    slideId,
    image: { width: 1920, height: 1080 },
    generatedAt: "2026-07-30T00:00:00.000Z",
    reviewStartedAt: null,
    blocks: [],
    unmatchedReferenceCandidates: [],
  };
}

function activityRecord(detail: string): ActivityRecord {
  return {
    at: "2026-07-30T00:00:00.000Z",
    kind: "run-start",
    slideId: null,
    pageLabel: null,
    stage: null,
    result: "success",
    durationMs: null,
    detail,
  };
}

beforeEach(() => {
  useDeckStore.getState().reset();
  useSlideStore.getState().reset();
  useActivityStore.getState().reset();
});

describe("deck-store.refreshStatus 的切换守卫", () => {
  function openOldDeck(): void {
    useDeckStore.setState({
      deckPath: "/decks/old",
      name: "old",
      deckId: "id-old",
      slides: [slide("old-1")],
      summary: SUMMARY,
    });
  }

  it("期间切换工作区时，旧 deck 的响应不写入", async () => {
    const pending = deferred<DeckStatusDetailedResult>();
    stubApi({ deck: { statusDetailed: () => pending.promise } });
    openOldDeck();

    const inFlight = useDeckStore.getState().refreshStatus();
    // 切走：openDeck 成功后套用新 deck 的等效结果
    useDeckStore.setState({
      ...detailed("/decks/new", [slide("new-1")]),
      loading: false,
    });
    pending.resolve(detailed("/decks/old", [slide("old-1")]));
    await inFlight;

    const state = useDeckStore.getState();
    expect(state.deckPath).toBe("/decks/new");
    expect(state.slides.map((item) => item.slideId)).toEqual(["new-1"]);
  });

  it("期间切换工作区时，旧 deck 的失败不写 error", async () => {
    const pending = deferred<DeckStatusDetailedResult>();
    stubApi({ deck: { statusDetailed: () => pending.promise } });
    openOldDeck();

    const inFlight = useDeckStore.getState().refreshStatus();
    useDeckStore.setState({
      ...detailed("/decks/new", [slide("new-1")]),
      loading: false,
    });
    pending.reject(new Error("旧 deck 的目录已不存在"));
    await expect(inFlight).rejects.toThrow("旧 deck 的目录已不存在");

    expect(useDeckStore.getState().error).toBeNull();
  });

  it("未切换时结果照常写入（正对照）", async () => {
    stubApi({
      deck: {
        statusDetailed: async () => detailed("/decks/old", [slide("old-2")]),
      },
    });
    openOldDeck();

    await useDeckStore.getState().refreshStatus();

    expect(useDeckStore.getState().slides.map((item) => item.slideId)).toEqual([
      "old-2",
    ]);
    expect(useDeckStore.getState().loading).toBe(false);
  });
});

describe("deck-store.refreshSlide 的切换守卫", () => {
  // 两个 deck 的 slideId 各自从 page-01 起编，重名是常态——正是重名时迟到的结果
  // 会真的替换掉新 deck 的同名页，因此用例必须取同名场景
  it("期间切换工作区时，旧 deck 的同名页结果不替换新 deck 的页", async () => {
    const pending = deferred<DeckStatusDetailedResult>();
    stubApi({ deck: { statusDetailed: () => pending.promise } });
    useDeckStore.setState({
      deckPath: "/decks/old",
      slides: [slide("page-01", "旧 deck 第 1 页")],
      summary: SUMMARY,
    });

    const inFlight = useDeckStore.getState().refreshSlide("page-01");
    const newDeck = detailed("/decks/new", [
      slide("page-01", "新 deck 第 1 页"),
    ]);
    useDeckStore.setState({ ...newDeck, loading: false });
    pending.resolve(
      detailed("/decks/old", [slide("page-01", "旧 deck 第 1 页")]),
    );
    await inFlight;

    const state = useDeckStore.getState();
    expect(state.deckPath).toBe("/decks/new");
    expect(state.slides.map((item) => item.pageLabel)).toEqual([
      "新 deck 第 1 页",
    ]);
    // 摘要是随同一次请求写回的，同样不能被旧 deck 的聚合值盖掉
    expect(state.summary).toBe(newDeck.summary);
  });

  it("期间切换工作区时，旧 deck 的失败不写 error", async () => {
    const pending = deferred<DeckStatusDetailedResult>();
    stubApi({ deck: { statusDetailed: () => pending.promise } });
    useDeckStore.setState({
      deckPath: "/decks/old",
      slides: [slide("page-01")],
      summary: SUMMARY,
    });

    const inFlight = useDeckStore.getState().refreshSlide("page-01");
    useDeckStore.setState({
      ...detailed("/decks/new", [slide("page-01")]),
      loading: false,
    });
    pending.reject(new Error("旧 deck 的目录已不存在"));
    await expect(inFlight).rejects.toThrow("旧 deck 的目录已不存在");

    expect(useDeckStore.getState().error).toBeNull();
  });

  it("未切换时目标页照常更新（正对照）", async () => {
    stubApi({
      deck: {
        statusDetailed: async () =>
          detailed("/decks/old", [slide("old-1", "已更新")]),
      },
    });
    useDeckStore.setState({
      deckPath: "/decks/old",
      slides: [slide("old-1")],
      summary: SUMMARY,
    });

    await useDeckStore.getState().refreshSlide("old-1");

    expect(useDeckStore.getState().slides[0]?.pageLabel).toBe("已更新");
  });
});

describe("slide-store.loadSlide 的切页/切换守卫", () => {
  it("加载期间切到另一页时，上一页的复核文档不覆盖新页", async () => {
    const first = deferred<TextReviewDocument | null>();
    stubApi({
      slide: {
        loadReview: (path: string) =>
          path === "/decks/old/slides/page-01"
            ? first.promise
            : Promise.resolve(reviewDoc("page-02")),
        loadImage: async () => null,
      },
    });

    const inFlight = useSlideStore
      .getState()
      .loadSlide("/decks/old/slides/page-01");
    await useSlideStore.getState().loadSlide("/decks/old/slides/page-02");
    first.resolve(reviewDoc("page-01"));
    await inFlight;

    const state = useSlideStore.getState();
    expect(state.workspacePath).toBe("/decks/old/slides/page-02");
    expect(state.reviewDocument?.slideId).toBe("page-02");
  });

  it("加载期间切换工作区（reset 把 workspacePath 置 null）时，迟到的文档不写入", async () => {
    const pending = deferred<TextReviewDocument | null>();
    stubApi({
      slide: {
        loadReview: () => pending.promise,
        loadImage: async () => null,
      },
    });

    const inFlight = useSlideStore
      .getState()
      .loadSlide("/decks/old/slides/page-01");
    // 切换工作区会清零 slide-store，workspacePath 归 null
    useSlideStore.getState().reset();
    pending.resolve(reviewDoc("page-01"));
    await inFlight;

    const state = useSlideStore.getState();
    expect(state.workspacePath).toBeNull();
    expect(state.reviewDocument).toBeNull();
    expect(state.loading).toBe(false);
  });

  it("未切页时文档照常写入（正对照）", async () => {
    stubApi({
      slide: {
        loadReview: async () => reviewDoc("page-01"),
        loadImage: async () => "data:image/png;base64,AAA",
      },
    });

    await useSlideStore.getState().loadSlide("/decks/old/slides/page-01");

    const state = useSlideStore.getState();
    expect(state.slideId).toBe("page-01");
    expect(state.sourceImageUrl).toBe("data:image/png;base64,AAA");
    expect(state.dirty).toBe(false);
  });
});

describe("activity-store.load 的最后一次请求 wins", () => {
  it("切换工作区后，旧 deck 的日志响应不覆盖新 deck 的日志", async () => {
    const oldPending = deferred<ActivityRecord[]>();
    stubApi({
      activity: {
        list: (deckPath: string) =>
          deckPath === "/decks/old"
            ? oldPending.promise
            : Promise.resolve([activityRecord("新 deck 的日志")]),
      },
    });

    const inFlight = useActivityStore.getState().load("/decks/old");
    useActivityStore.getState().reset();
    await useActivityStore.getState().load("/decks/new");
    oldPending.resolve([activityRecord("旧 deck 的日志")]);
    await inFlight;

    expect(
      useActivityStore.getState().records.map((item) => item.detail),
    ).toEqual(["新 deck 的日志"]);
  });

  it("只 reset 尚未发出新请求时，旧 deck 的迟到响应也不写入", async () => {
    const pending = deferred<ActivityRecord[]>();
    stubApi({ activity: { list: () => pending.promise } });

    const inFlight = useActivityStore.getState().load("/decks/old");
    // 新 deck 的 load 由 ConsolePage 的 effect 发出，这里模拟它还没轮到
    useActivityStore.getState().reset();
    pending.resolve([activityRecord("旧 deck 的日志")]);
    await inFlight;

    expect(useActivityStore.getState().records).toEqual([]);
  });

  it("迟到的失败不写 error", async () => {
    const pending = deferred<ActivityRecord[]>();
    stubApi({ activity: { list: () => pending.promise } });

    const inFlight = useActivityStore.getState().load("/decks/old");
    useActivityStore.getState().reset();
    pending.reject(new Error("旧 deck 的日志读不到"));
    await expect(inFlight).rejects.toThrow("旧 deck 的日志读不到");

    expect(useActivityStore.getState().error).toBeNull();
  });

  it("单个请求照常写入（正对照）", async () => {
    stubApi({
      activity: { list: async () => [activityRecord("本 deck 的日志")] },
    });

    await useActivityStore.getState().load("/decks/old");

    expect(useActivityStore.getState().records).toHaveLength(1);
    expect(useActivityStore.getState().loading).toBe(false);
  });
});
