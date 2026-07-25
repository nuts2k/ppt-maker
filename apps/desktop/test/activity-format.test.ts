import { describe, expect, it } from "vitest";
import type { ActivityRecord, DeckRunEvent } from "../src/main/ipc/channels.js";
import {
  describeActivity,
  formatDuration,
  groupByDate,
  runEventToActivity,
} from "../src/renderer/stores/activity-format.js";

/** 构造记录：只覆盖测试关心的字段，其余取空值 */
function record(
  input: Partial<ActivityRecord> & { at: string },
): ActivityRecord {
  return {
    at: input.at,
    kind: input.kind ?? "page-done",
    slideId: input.slideId ?? null,
    pageLabel: input.pageLabel ?? null,
    stage: input.stage ?? null,
    result: input.result ?? "info",
    durationMs: input.durationMs ?? null,
    detail: input.detail ?? "",
  };
}

/** 用本地时区构造 ISO 时间串，避免测试结果随机器时区漂移 */
function localAt(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
): string {
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}

const ctx = {
  pageLabelOf(slideId: string): string | null {
    return slideId === "slide-1" ? "page-01" : null;
  },
};

describe("groupByDate", () => {
  it("按本地日期分组，组间与组内均按时间倒序", () => {
    const groups = groupByDate([
      record({ at: localAt(2026, 7, 22, 9, 0), detail: "旧日上午" }),
      record({ at: localAt(2026, 7, 24, 8, 0), detail: "今日早" }),
      record({ at: localAt(2026, 7, 22, 21, 30), detail: "旧日晚上" }),
      record({ at: localAt(2026, 7, 24, 20, 15), detail: "今日晚" }),
    ]);

    expect(groups.map((group) => group.date)).toEqual([
      "2026-07-24",
      "2026-07-22",
    ]);
    expect(groups[0]?.records.map((item) => item.detail)).toEqual([
      "今日晚",
      "今日早",
    ]);
    expect(groups[1]?.records.map((item) => item.detail)).toEqual([
      "旧日晚上",
      "旧日上午",
    ]);
  });

  it("空输入返回空数组", () => {
    expect(groupByDate([])).toEqual([]);
  });

  it("时间无法解析的记录归入未知日期并沉底", () => {
    const groups = groupByDate([
      record({ at: "not-a-date", detail: "坏行" }),
      record({ at: localAt(2026, 7, 24, 8, 0), detail: "正常" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.date).toBe("2026-07-24");
    expect(groups[1]?.date).toBe("未知日期");
  });
});

describe("runEventToActivity", () => {
  it("run-start 记录入队页数", () => {
    const event: DeckRunEvent = {
      kind: "run-start",
      total: 3,
      slideIds: ["slide-1"],
    };
    const result = runEventToActivity(event, ctx);
    expect(result?.kind).toBe("run-start");
    expect(result?.result).toBe("info");
    expect(result?.detail).toBe("开始执行 3 页");
  });

  it("page-start 直接使用事件自带的页名", () => {
    const result = runEventToActivity(
      {
        kind: "page-start",
        slideId: "slide-1",
        pageLabel: "page-01",
        index: 1,
        total: 3,
      },
      ctx,
    );
    expect(result?.detail).toBe("开始处理 page-01");
    expect(result?.pageLabel).toBe("page-01");
  });

  it("stage-start 不进流水，返回 null", () => {
    const result = runEventToActivity(
      {
        kind: "stage-start",
        slideId: "slide-1",
        stage: "ocr",
        at: localAt(2026, 7, 24, 10, 0),
      },
      ctx,
    );
    expect(result).toBeNull();
  });

  it("stage-complete 带阶段中文名、耗时与事件时间", () => {
    const at = localAt(2026, 7, 24, 10, 5);
    const result = runEventToActivity(
      {
        kind: "stage-complete",
        slideId: "slide-1",
        stage: "mask",
        at,
        durationMs: 12_300,
      },
      ctx,
    );
    expect(result?.at).toBe(at);
    expect(result?.stage).toBe("mask");
    expect(result?.durationMs).toBe(12_300);
    expect(result?.result).toBe("success");
    expect(result?.detail).toBe("page-01 · 生成遮罩 完成");
  });

  it("未知 slideId 回落到 slideId 本身作页名", () => {
    const result = runEventToActivity(
      {
        kind: "stage-complete",
        slideId: "slide-x",
        stage: "ocr",
        at: localAt(2026, 7, 24, 10, 6),
        durationMs: 500,
      },
      ctx,
    );
    expect(result?.detail).toBe("slide-x · 文字识别 完成");
  });

  it("page-done 按 gate/error 区分 success / gate / failure", () => {
    const base = {
      kind: "page-done",
      slideId: "slide-1",
      gate: null,
      stoppedAt: null,
      message: "全部阶段完成",
      error: null,
    } as const;

    expect(runEventToActivity(base, ctx)?.result).toBe("success");

    expect(
      runEventToActivity(
        {
          ...base,
          gate: "manual",
          stoppedAt: "accept-clean",
          message: "等待验收底图",
        },
        ctx,
      )?.result,
    ).toBe("gate");

    const failure = runEventToActivity(
      {
        ...base,
        gate: "error",
        stoppedAt: "clean",
        message: "生成失败",
        error: { code: "PIPELINE_STAGE_FAILED", message: "生成失败" },
      },
      ctx,
    );
    expect(failure?.result).toBe("failure");
    expect(failure?.stage).toBe("clean");
    expect(failure?.detail).toBe("page-01 · 生成失败");
  });

  it("run-stopping 映射为 main 的 run-stop 记录", () => {
    const result = runEventToActivity({ kind: "run-stopping" }, ctx);
    expect(result?.kind).toBe("run-stop");
    expect(result?.detail).toBe("已请求停止，当前页完成后结束");
  });

  it("run-done 汇总；有失败时结果为 failure", () => {
    const ok = runEventToActivity(
      {
        kind: "run-done",
        summary: { total: 3, completed: 2, gated: 1, failed: 0 },
      },
      ctx,
    );
    expect(ok?.result).toBe("info");
    expect(ok?.detail).toBe("执行结束：完成 2，待人工 1，失败 0");

    const bad = runEventToActivity(
      {
        kind: "run-done",
        summary: { total: 3, completed: 1, gated: 0, failed: 2 },
      },
      ctx,
    );
    expect(bad?.result).toBe("failure");
  });
});

describe("describeActivity", () => {
  it("有耗时时追加用时后缀", () => {
    const line = describeActivity(
      record({
        at: localAt(2026, 7, 24, 10, 5),
        kind: "stage-complete",
        stage: "mask",
        detail: "page-01 · 生成遮罩 完成",
        durationMs: 12_300,
      }),
    );
    expect(line).toBe("page-01 · 生成遮罩 完成 · 用时 12.3s");
  });

  it("无耗时时只返回正文", () => {
    const line = describeActivity(
      record({
        at: localAt(2026, 7, 24, 10, 5),
        kind: "page-start",
        detail: "开始处理 page-01",
      }),
    );
    expect(line).toBe("开始处理 page-01");
  });

  it("detail 缺失时用页名 + 阶段中文名 + kind 兜底", () => {
    const line = describeActivity(
      record({
        at: localAt(2026, 7, 24, 10, 5),
        kind: "stage-complete",
        pageLabel: "page-02",
        stage: "accept-pptx",
        detail: "   ",
        durationMs: 800,
      }),
    );
    expect(line).toBe("page-02 · 验收 PPTX · 阶段完成 · 用时 800ms");
  });

  it("未知阶段 id 原样展示，不抛错", () => {
    const line = describeActivity(
      record({
        at: localAt(2026, 7, 24, 10, 5),
        kind: "custom-kind",
        stage: "unknown-stage",
        detail: "",
      }),
    );
    expect(line).toBe("unknown-stage · custom-kind");
  });
});

describe("formatDuration", () => {
  it("按毫秒 / 秒 / 分秒分档", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(12_345)).toBe("12.3s");
    expect(formatDuration(65_000)).toBe("1m5s");
  });
});
