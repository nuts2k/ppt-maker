/**
 * planning 视图的规则回归锁。
 *
 * 本项目没有 DOM 测试库；脏判定、清单分类与付费文案直接测纯函数产物。
 */

import type { ContentSpec, SpecChangeRecord } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import type { SlideDetail } from "../src/main/ipc/channels.js";
import {
  buildCreatePagesConfirm,
  buildRegenerateBatchConfirm,
  classifyOutdatedPages,
  classifyPendingEntries,
  isDirty,
  isEmptyChangeRecord,
  pendingEntrySummaries,
} from "../src/renderer/lib/planning-core.js";

function makeEntry(
  specEntryId = "entry-001",
  overrides: Partial<ContentSpec["entries"][number]> = {},
): ContentSpec["entries"][number] {
  return {
    specEntryId,
    pageType: "cover",
    textGroups: [{ label: "标题", items: ["内容策划工作台"] }],
    visualIntent: "居中大标题",
    revisionNotes: [],
    ...overrides,
  };
}

function makeSpec(overrides: Partial<ContentSpec> = {}): ContentSpec {
  return {
    schemaVersion: 1,
    specId: "spec-1",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    style: { description: "克制的编辑部校样风" },
    entries: [makeEntry()],
    ...overrides,
  };
}

function makeSlide(overrides: Partial<SlideDetail> = {}): SlideDetail {
  return {
    slideId: "slide-page-01",
    workspacePath: "slides/page-01",
    absWorkspacePath: "/decks/demo/slides/page-01",
    pageLabel: "page-01",
    sourceImageName: "page-01.png",
    currentStage: "report",
    stageStatus: "completed",
    removed: false,
    sourceKind: "generated",
    hasExtractableText: null,
    sourceAcceptance: "manual",
    specEntryId: "entry-001",
    regenerableSpecEntryId: "entry-001",
    specDrift: "in-sync",
    stages: [],
    lastError: null,
    stageDurations: {},
    pendingTextReview: 0,
    ...overrides,
  };
}

function makeRecord(
  fingerprints: SpecChangeRecord["fingerprints"],
): SpecChangeRecord {
  return {
    v: 1,
    recordId: "record-1",
    at: "2026-08-04T00:00:00.000Z",
    origin: "manual",
    summary: "更新标题",
    styleBefore: { description: "旧风格" },
    styleAfter: { description: "新风格" },
    entriesBefore: [],
    entriesAfter: [],
    fingerprints,
    conversationRef: null,
    rollbackOf: null,
  };
}

describe("规格草稿脏判定", () => {
  it("没有草稿时不脏，新建规格草稿时为脏", () => {
    expect(isDirty(null, null)).toBe(false);
    expect(isDirty(null, makeSpec())).toBe(true);
  });

  it("忽略时间戳差异，识别样式、条目内容与顺序变化", () => {
    const saved = makeSpec();
    const first = makeEntry();
    const second = makeEntry("entry-002");
    expect(
      isDirty(saved, makeSpec({ updatedAt: "2026-08-05T00:00:00.000Z" })),
    ).toBe(false);
    expect(
      isDirty(saved, makeSpec({ style: { description: "明亮留白风" } })),
    ).toBe(true);
    expect(
      isDirty(
        makeSpec({
          entries: [first, second],
        }),
        makeSpec({
          entries: [second, first],
        }),
      ),
    ).toBe(true);
  });
});

describe("过时页分类", () => {
  it("只把生成页分入漂移与失联，非生成来源单列为不适用", () => {
    const drifted = makeSlide({
      slideId: "s1",
      pageLabel: "page-01",
      specDrift: "drifted",
    });
    const missing = makeSlide({
      slideId: "s2",
      pageLabel: "page-02",
      specDrift: "missing",
    });
    const imported = makeSlide({
      slideId: "s3",
      pageLabel: "page-03",
      sourceKind: "imported",
      specEntryId: null,
      regenerableSpecEntryId: null,
      specDrift: null,
    });
    const inSync = makeSlide({
      slideId: "s4",
      pageLabel: "page-04",
      specDrift: "in-sync",
    });

    const result = classifyOutdatedPages([drifted, missing, imported, inSync]);
    expect(result.drifted.map((slide) => slide.pageLabel)).toEqual(["page-01"]);
    expect(result.missing.map((slide) => slide.pageLabel)).toEqual(["page-02"]);
    expect(result.notApplicable.map((slide) => slide.pageLabel)).toEqual([
      "page-03",
    ]);
  });
});

describe("待建条目分类", () => {
  const spec = makeSpec({
    entries: [makeEntry("entry-001"), makeEntry("entry-002"), makeEntry("e3")],
  });

  it("零页 deck 时全部条目待建", () => {
    expect(
      classifyPendingEntries(spec, []).map((entry) => entry.specEntryId),
    ).toEqual(["entry-001", "entry-002", "e3"]);
  });

  it("没有规格时不产生任何待建条目", () => {
    expect(classifyPendingEntries(null, [])).toEqual([]);
  });

  it("已建页的条目从待建里剔除", () => {
    const slides = [
      makeSlide({ slideId: "s1", pageLabel: "page-01" }),
      makeSlide({
        slideId: "s2",
        pageLabel: "page-02",
        specEntryId: "entry-002",
        regenerableSpecEntryId: "entry-002",
      }),
    ];
    expect(
      classifyPendingEntries(spec, slides).map((entry) => entry.specEntryId),
    ).toEqual(["e3"]);
  });

  /*
   * 既有语义，本任务第一次把它暴露到界面上：CLI 的 `collectGeneratedPages` 跳过
   * `removedAt !== null` 的页，因此软删除后该条目重新算作 `newEntries`，再建一次
   * 会得到一页新的。渲染层漏掉这道过滤，「待建 N 条」就会比实际少。
   */
  it("软删除的页不占用条目，其规格条目重新回到待建", () => {
    const slides = [
      makeSlide({ slideId: "s1", pageLabel: "page-01", removed: true }),
      makeSlide({
        slideId: "s2",
        pageLabel: "page-02",
        specEntryId: "entry-002",
        regenerableSpecEntryId: "entry-002",
      }),
    ];
    expect(
      classifyPendingEntries(spec, slides).map((entry) => entry.specEntryId),
    ).toEqual(["entry-001", "e3"]);
  });

  /*
   * 另一道过滤：CLI 只认 `source.kind === "generated"`。换源成 imported 的页
   * 仍带着历史生成快照（`regenerableSpecEntryId`），但它已经不是这条规格建出的页了。
   */
  it("非生成来源页的规格条目不参与匹配", () => {
    const slides = [
      makeSlide({
        slideId: "s1",
        pageLabel: "page-01",
        sourceKind: "imported",
        specEntryId: "entry-001",
        regenerableSpecEntryId: "entry-001",
        specDrift: null,
      }),
    ];
    expect(
      classifyPendingEntries(spec, slides).map((entry) => entry.specEntryId),
    ).toEqual(["entry-001", "entry-002", "e3"]);
  });

  it("待建条目按规格顺序给出页型与一行标题，不裸露条目 id", () => {
    const titled = makeSpec({
      entries: [
        makeEntry("entry-001"),
        makeEntry("entry-002", {
          pageType: "content",
          textGroups: [{ label: "要点", items: ["三条硬约束"] }],
        }),
      ],
    });
    const slides = [makeSlide({ slideId: "s1", pageLabel: "page-01" })];

    expect(pendingEntrySummaries(titled, slides)).toEqual([
      {
        specEntryId: "entry-002",
        pageType: "content",
        title: "三条硬约束",
      },
    ]);
    expect(pendingEntrySummaries(null, slides)).toEqual([]);
  });
});

describe("按规格建页付费门槛", () => {
  it("写明确切次数与不可撤销，不用「最多」的口径", () => {
    const options = buildCreatePagesConfirm(3);
    expect(options.message).toContain("3 次");
    expect(options.message).not.toContain("最多");
    expect(options.detail).not.toContain("最多");
    expect(options.detail).toContain("不可撤销");
    expect(options.detail).toContain("确认源图");
    expect(options.confirmLabel).toContain("3 页");
    expect(options.confirmLabel).not.toContain("最多");
  });
});

describe("批量重生成付费门槛", () => {
  it("写明确切次数、不可撤销与下游复核影响", () => {
    const options = buildRegenerateBatchConfirm(["page-01", "page-03"]);
    expect(options.message).toContain("2 次");
    expect(options.message).not.toContain("最多");
    expect(options.detail).toContain("不可撤销");
    expect(options.detail).toContain("OCR 复核基准");
    expect(options.detail).toContain("重新确认源图");
    expect(options.confirmLabel).toContain("2 页");
  });
});

describe("历史记录视觉权重", () => {
  it("只按指纹集合是否为空判断无内容变更", () => {
    expect(isEmptyChangeRecord(makeRecord([]))).toBe(true);
    expect(
      isEmptyChangeRecord(
        makeRecord([{ specEntryId: "entry-001", before: "old", after: "new" }]),
      ),
    ).toBe(false);
  });
});
