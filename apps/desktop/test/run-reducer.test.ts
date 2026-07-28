import { describe, expect, it } from "vitest";
import type { DeckRunEvent } from "../src/main/ipc/channels.js";
import {
  applyRunEvent,
  createRunSnapshot,
  elapsedMs,
  withoutSlideLiveStages,
} from "../src/renderer/stores/run-reducer.js";
import type { RunSnapshot } from "../src/renderer/stores/run-types.js";

const T0 = 1_700_000_000_000;

/** 按事件序列连续推进，时间从 T0 起每步 +1000ms */
function replay(
  events: readonly DeckRunEvent[],
  start: RunSnapshot = createRunSnapshot(),
): RunSnapshot {
  return events.reduce(
    (snapshot, event, index) =>
      applyRunEvent(snapshot, event, T0 + index * 1000),
    start,
  );
}

describe("createRunSnapshot", () => {
  it("初始态为空闲且无任何历史", () => {
    expect(createRunSnapshot()).toEqual({
      status: "idle",
      total: 0,
      doneCount: 0,
      currentSlideId: null,
      currentPageLabel: null,
      currentIndex: 0,
      currentStage: null,
      stageStartedAt: null,
      liveStages: {},
      sessionResults: {},
      lastSummary: null,
    });
  });
});

describe("applyRunEvent 完整事件序列", () => {
  const events: DeckRunEvent[] = [
    { kind: "run-start", total: 1, slideIds: ["s1"] },
    {
      kind: "page-start",
      slideId: "s1",
      pageLabel: "page-01",
      index: 1,
      total: 1,
    },
    { kind: "stage-start", slideId: "s1", stage: "ocr", at: "t" },
    {
      kind: "stage-complete",
      slideId: "s1",
      stage: "ocr",
      at: "t",
      durationMs: 1200,
    },
    { kind: "stage-start", slideId: "s1", stage: "review", at: "t" },
    {
      kind: "stage-complete",
      slideId: "s1",
      stage: "review",
      at: "t",
      durationMs: 300,
    },
    {
      kind: "page-done",
      slideId: "s1",
      gate: "manual",
      stoppedAt: "accept-clean",
      message: "等待验收底图",
      error: null,
    },
    {
      kind: "run-done",
      summary: { total: 1, completed: 0, gated: 1, failed: 0 },
    },
  ];

  it("run-start 置为执行中并记录总页数", () => {
    const snapshot = replay(events.slice(0, 1));
    expect(snapshot.status).toBe("running");
    expect(snapshot.total).toBe(1);
    expect(snapshot.doneCount).toBe(0);
  });

  it("page-start 写入当前页（index 为 1-based）", () => {
    const snapshot = replay(events.slice(0, 2));
    expect(snapshot.currentSlideId).toBe("s1");
    expect(snapshot.currentPageLabel).toBe("page-01");
    expect(snapshot.currentIndex).toBe(1);
    expect(snapshot.currentStage).toBeNull();
  });

  it("stage-start 记录当前阶段与开始时刻", () => {
    const snapshot = replay(events.slice(0, 3));
    expect(snapshot.currentStage).toBe("ocr");
    expect(snapshot.stageStartedAt).toBe(T0 + 2000);
    expect(snapshot.liveStages.s1).toEqual({ ocr: "running" });
  });

  it("stage-complete 标记完成并清空计时", () => {
    const snapshot = replay(events.slice(0, 4));
    expect(snapshot.currentStage).toBeNull();
    expect(snapshot.stageStartedAt).toBeNull();
    expect(snapshot.liveStages.s1).toEqual({ ocr: "completed" });
  });

  it("多阶段累积在同一页的实时状态表中", () => {
    const snapshot = replay(events.slice(0, 6));
    expect(snapshot.liveStages.s1).toEqual({
      ocr: "completed",
      review: "completed",
    });
  });

  it("page-done 写入会话结果并累加完成数", () => {
    const snapshot = replay(events.slice(0, 7));
    expect(snapshot.doneCount).toBe(1);
    expect(snapshot.currentSlideId).toBeNull();
    expect(snapshot.currentPageLabel).toBeNull();
    expect(snapshot.sessionResults.s1).toEqual({
      slideId: "s1",
      gate: "manual",
      stoppedAt: "accept-clean",
      message: "等待验收底图",
      error: null,
    });
  });

  it("run-done 回到空闲并保留本轮结果", () => {
    const snapshot = replay(events);
    expect(snapshot.status).toBe("idle");
    expect(snapshot.currentIndex).toBe(0);
    expect(snapshot.currentStage).toBeNull();
    expect(snapshot.stageStartedAt).toBeNull();
    expect(snapshot.lastSummary).toEqual({
      total: 1,
      completed: 0,
      gated: 1,
      failed: 0,
    });
    // 卡片轨道与待办队列依赖这两份会话层数据，run-done 后不得清空
    expect(snapshot.liveStages.s1).toEqual({
      ocr: "completed",
      review: "completed",
    });
    expect(snapshot.sessionResults.s1?.gate).toBe("manual");
  });

  it("新一轮 run-start 清空上一轮的会话层数据", () => {
    const finished = replay(events);
    const restarted = applyRunEvent(
      finished,
      { kind: "run-start", total: 3, slideIds: ["s1", "s2", "s3"] },
      T0,
    );
    expect(restarted.total).toBe(3);
    expect(restarted.doneCount).toBe(0);
    expect(restarted.liveStages).toEqual({});
    expect(restarted.sessionResults).toEqual({});
    expect(restarted.lastSummary).toBeNull();
  });
});

describe("applyRunEvent 停止与失败", () => {
  it("run-stopping 置为停止中且不清空当前页", () => {
    const base = replay([
      { kind: "run-start", total: 2, slideIds: ["s1", "s2"] },
      {
        kind: "page-start",
        slideId: "s1",
        pageLabel: "page-01",
        index: 1,
        total: 2,
      },
    ]);
    const stopping = applyRunEvent(base, { kind: "run-stopping" }, T0);
    expect(stopping.status).toBe("stopping");
    expect(stopping.currentSlideId).toBe("s1");
  });

  it("失败页的 page-done 写入错误信息", () => {
    const snapshot = replay([
      { kind: "run-start", total: 1, slideIds: ["s1"] },
      {
        kind: "page-start",
        slideId: "s1",
        pageLabel: "page-01",
        index: 1,
        total: 1,
      },
      {
        kind: "page-done",
        slideId: "s1",
        gate: "error",
        stoppedAt: "mask",
        message: "遮罩生成失败",
        error: { code: "PIPELINE_STAGE_FAILED", message: "遮罩生成失败" },
      },
    ]);
    expect(snapshot.sessionResults.s1?.error).toEqual({
      code: "PIPELINE_STAGE_FAILED",
      message: "遮罩生成失败",
    });
    expect(snapshot.sessionResults.s1?.stoppedAt).toBe("mask");
  });

  it("page-start 的 total 随运行中追加入队而刷新", () => {
    const snapshot = replay([
      { kind: "run-start", total: 1, slideIds: ["s1"] },
      {
        kind: "page-start",
        slideId: "s2",
        pageLabel: "page-02",
        index: 2,
        total: 3,
      },
    ]);
    expect(snapshot.total).toBe(3);
    expect(snapshot.currentIndex).toBe(2);
  });
});

describe("elapsedMs", () => {
  it("有进行中阶段时返回已用毫秒", () => {
    const snapshot = replay([
      { kind: "run-start", total: 1, slideIds: ["s1"] },
      { kind: "stage-start", slideId: "s1", stage: "ocr", at: "t" },
    ]);
    expect(snapshot.stageStartedAt).toBe(T0 + 1000);
    expect(elapsedMs(snapshot, T0 + 4500)).toBe(3500);
  });

  it("无进行中阶段时返回 null", () => {
    expect(elapsedMs(createRunSnapshot(), T0)).toBeNull();
  });

  it("时钟回拨时不返回负值", () => {
    const snapshot = replay([
      { kind: "stage-start", slideId: "s1", stage: "ocr", at: "t" },
    ]);
    expect(elapsedMs(snapshot, T0 - 5000)).toBe(0);
  });
});

describe("不可变性", () => {
  it("推进不修改入参快照", () => {
    const base = replay([
      { kind: "run-start", total: 1, slideIds: ["s1"] },
      { kind: "stage-start", slideId: "s1", stage: "ocr", at: "t" },
    ]);
    const beforeJson = JSON.stringify(base);

    const next = applyRunEvent(
      base,
      {
        kind: "stage-complete",
        slideId: "s1",
        stage: "ocr",
        at: "t",
        durationMs: 10,
      },
      T0 + 2000,
    );

    expect(JSON.stringify(base)).toBe(beforeJson);
    expect(next).not.toBe(base);
    expect(next.liveStages).not.toBe(base.liveStages);
    expect(next.liveStages.s1).not.toBe(base.liveStages.s1);
    expect(base.liveStages.s1).toEqual({ ocr: "running" });
  });

  it("page-done 不修改入参的 sessionResults", () => {
    const base = replay([{ kind: "run-start", total: 1, slideIds: ["s1"] }]);
    const next = applyRunEvent(
      base,
      {
        kind: "page-done",
        slideId: "s1",
        gate: null,
        stoppedAt: null,
        message: "完成",
        error: null,
      },
      T0,
    );
    expect(base.sessionResults).toEqual({});
    expect(next.sessionResults).not.toBe(base.sessionResults);
  });
});

describe("withoutSlideLiveStages", () => {
  it("丢弃目标页的会话层阶段状态，其余页原样保留", () => {
    const live = {
      s1: { mask: "completed" as const, clean: "completed" as const },
      s2: { mask: "running" as const },
    };
    expect(withoutSlideLiveStages(live, "s1")).toEqual({
      s2: { mask: "running" },
    });
  });

  it("目标页本就没有会话层状态时返回同一引用（不触发无谓重渲染）", () => {
    const live = { s2: { mask: "running" as const } };
    expect(withoutSlideLiveStages(live, "s1")).toBe(live);
  });

  it("不修改入参", () => {
    const live = { s1: { mask: "completed" as const } };
    withoutSlideLiveStages(live, "s1");
    expect(live).toEqual({ s1: { mask: "completed" } });
  });

  /**
   * E1 走查实测缺陷的回归锚点：run 结束后 liveStages 被刻意保留，人工失效阶段
   * 若不清它，deriveStageViews 的会话层覆盖会让磁盘上的 stale 显示成 completed。
   */
  it("清理后该页在 deriveStageViews 里回落到耐久层的 stale", () => {
    const live = replay([
      { kind: "run-start", total: 1, slideIds: ["s1"] },
      { kind: "stage-start", slideId: "s1", stage: "mask", at: "" },
      {
        kind: "stage-complete",
        slideId: "s1",
        stage: "mask",
        at: "",
        durationMs: 1,
      },
    ]).liveStages;
    expect(live.s1?.mask).toBe("completed");
    expect(withoutSlideLiveStages(live, "s1").s1).toBeUndefined();
  });
});
