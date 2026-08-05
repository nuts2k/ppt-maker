/**
 * 控制台零页空态的规则锁（R7 / A8）。
 *
 * 本项目没有 DOM 测试库，空态的措辞判断因此被抽成纯函数，断言直接落在它的产物上。
 * 三条分支各一例：规格里有待建条目、deck 无规格、读规格失败。后两条必须**退回同一
 * 段兜底文案且不抛**——空态是「告诉你现在能干什么」的地方，在这里报错只会把一个
 * 本来就一无所有的界面变得更吓人。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ContentSpec } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import type { SlideDetail } from "../src/main/ipc/channels.js";
import {
  buildEmptyDeckCopy,
  pendingSpecCount,
  probeDeckSpec,
  specForDeck,
} from "../src/renderer/lib/console-empty-view.js";

function makeSpec(entryIds: readonly string[]): ContentSpec {
  return {
    schemaVersion: 1,
    specId: "spec-1",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    style: { description: "克制的编辑部校样风" },
    entries: entryIds.map((specEntryId) => ({
      specEntryId,
      pageType: "cover",
      textGroups: [{ label: "标题", items: ["内容策划工作台"] }],
      visualIntent: "居中大标题",
      revisionNotes: [],
    })),
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

describe("零页空态的待建条数", () => {
  it("有规格时给出尚未建页的条目数，口径直接取自 classifyPendingEntries", () => {
    const spec = makeSpec(["entry-001", "entry-002", "entry-003"]);
    expect(pendingSpecCount(spec, [])).toBe(3);
    expect(pendingSpecCount(spec, [makeSlide()])).toBe(2);
  });

  it("读不到规格与「规格在但零条待建」是两种结局，不折成同一个数", () => {
    expect(pendingSpecCount(null, [])).toBe(null);
    expect(pendingSpecCount(makeSpec([]), [])).toBe(0);
  });
});

describe("读 deck 规格的失败降级", () => {
  it("IPC 如实返回 null（deck 没有规格）时原样透出", async () => {
    await expect(probeDeckSpec(async () => null)).resolves.toBe(null);
  });

  it("读失败时返回 null 而不是抛出——空态不因此变成错误页", async () => {
    await expect(
      probeDeckSpec(async () => {
        throw new Error("EACCES: permission denied");
      }),
    ).resolves.toBe(null);
  });

  it("成功时原样透出规格，不在这一层做任何折算", async () => {
    const spec = makeSpec(["entry-001"]);
    await expect(probeDeckSpec(async () => spec)).resolves.toBe(spec);
  });
});

describe("切 deck 时不得把上一个 deck 的条数显示到新 deck 上", () => {
  const specA = makeSpec(["entry-001", "entry-002", "entry-003"]);
  const snapshot = { deckPath: "/decks/a", spec: specA } as const;

  it("快照属于当前 deck 时原样透出", () => {
    expect(specForDeck(snapshot, "/decks/a")).toBe(specA);
  });

  it("deck 已切走时当作「还不知道」，而不是沿用旧规格", () => {
    expect(specForDeck(snapshot, "/decks/b")).toBe(null);
    expect(specForDeck(snapshot, null)).toBe(null);
    expect(specForDeck(null, "/decks/a")).toBe(null);
  });

  /*
   * 这一条才是缺陷本体：切 deck 那一帧 deckPath 已经是 B、slides 已经是 B 的（空），
   * 但 state 里还挂着 A 的规格。少了归属判断，空态会对着一个可能连规格都没有的 B
   * 报「3 条待建」。
   */
  it("整条链路：拿 A 的快照配 B 的零页，算出的是 null 而不是 3", () => {
    expect(pendingSpecCount(specForDeck(snapshot, "/decks/b"), [])).toBe(null);
    expect(buildEmptyDeckCopy(null).actionLabel).toBe(null);
    // 反向确认：同一份快照配它自己的 deck，数字必须照常算得出来
    expect(pendingSpecCount(specForDeck(snapshot, "/decks/a"), [])).toBe(3);
  });
});

describe("待建条数的口径唯一性", () => {
  /*
   * 《静默失败诊断指南》：「界面上同一个数字有几处在算？两处各写一份 filter 必然漂移」。
   * 待建条数的唯一实现是 planning-core 的 `classifyPendingEntries`（它与 CLI 的
   * `collectGeneratedPages` 逐条对齐）。正向锁只能证明本模块调了它，挡不住后来人
   * 绕开模块在页面里就地再写一份，因此这里读源文件下一条反向锁。
   */
  function read(relPath: string): string {
    return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), {
      encoding: "utf8",
    });
  }

  it("console-empty-view 把条数算给 classifyPendingEntries，不自己数", () => {
    const source = read("../src/renderer/lib/console-empty-view.ts");
    expect(source).toContain("classifyPendingEntries");
    expect(source).not.toContain("sourceKind");
    expect(source).not.toContain("removed");
  });

  it("ConsolePage 不就地再写一份「哪些条目已建页」的过滤", () => {
    const source = read("../src/renderer/pages/ConsolePage.tsx");
    expect(source).toContain("pendingSpecCount");
    expect(source).not.toContain("specEntryId");
  });
});

describe("零页空态文案", () => {
  it("有待建条目时写明条数并指向策划工作台", () => {
    const copy = buildEmptyDeckCopy(6);
    expect(copy.body).toContain("6 条");
    expect(copy.body).toContain("策划工作台");
    expect(copy.actionLabel).toBe("去策划工作台");
  });

  it("无规格时退回原文案，且不给出指向策划工作台的动作", () => {
    const copy = buildEmptyDeckCopy(null);
    expect(copy.body).toBe(
      "用右上角「添加页面」从图片、PDF 或内容规格加进来。",
    );
    expect(copy.actionLabel).toBe(null);
  });

  it("规格在但零条待建时同样退回原文案——指过去是死路", () => {
    const copy = buildEmptyDeckCopy(0);
    expect(copy.body).toBe(
      "用右上角「添加页面」从图片、PDF 或内容规格加进来。",
    );
    expect(copy.actionLabel).toBe(null);
    expect(copy.body).not.toContain("0 条");
  });

  it("读失败这条链路走到底也落在兜底文案上", async () => {
    const spec = await probeDeckSpec(async () => {
      throw new Error("读盘失败");
    });
    const copy = buildEmptyDeckCopy(pendingSpecCount(spec, []));
    expect(copy.actionLabel).toBe(null);
    expect(copy.body).toBe(
      "用右上角「添加页面」从图片、PDF 或内容规格加进来。",
    );
  });
});
