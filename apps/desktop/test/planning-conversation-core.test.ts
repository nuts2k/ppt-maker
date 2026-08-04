import type { ContentSpec, ContentSpecEntry } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  buildDefaultProposalSelection,
  buildDimensionViews,
  buildProposalConfirm,
  buildProposalDiffSections,
  guardPlanningAction,
  normalizeProposalSelection,
  resolvePlanningPrimaryAction,
  resolveProposalMessageStatus,
  resolveSelectedEntryId,
} from "../src/renderer/lib/planning-conversation-core.js";

function entry(
  specEntryId: string,
  overrides: Partial<ContentSpecEntry> = {},
): ContentSpecEntry {
  return {
    specEntryId,
    pageType: "content",
    textGroups: [{ label: "标题", items: [specEntryId] }],
    visualIntent: "左右分栏",
    revisionNotes: [],
    ...overrides,
  };
}

function spec(
  style: string,
  entries: readonly ContentSpecEntry[],
): ContentSpec {
  return {
    schemaVersion: 1,
    specId: "spec-1",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    style: { description: style },
    entries: [...entries],
  };
}

describe("策划动作守卫", () => {
  it("E1 只阻止已有权威规格上的未保存草稿", () => {
    expect(
      guardPlanningAction({
        hasSavedSpec: true,
        dirty: true,
        hasPendingProposal: false,
        busy: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "请先保存或放弃右侧未保存的规格修改，再让模型改稿。",
    });
    expect(
      guardPlanningAction({
        hasSavedSpec: false,
        dirty: true,
        hasPendingProposal: false,
        busy: false,
      }).allowed,
    ).toBe(true);
  });

  it("E5 pending 优先给出明确下一步；空闲时正向放行", () => {
    expect(
      guardPlanningAction({
        hasSavedSpec: true,
        dirty: false,
        hasPendingProposal: true,
        busy: false,
      }).reason,
    ).toContain("接受或拒绝");
    expect(
      guardPlanningAction({
        hasSavedSpec: true,
        dirty: false,
        hasPendingProposal: false,
        busy: false,
      }),
    ).toEqual({ allowed: true, reason: null });
  });
});

describe("五维度与条目身份", () => {
  it("维度固定顺序，空快照按待补充展示", () => {
    const views = buildDimensionViews(null);
    expect(views.map((item) => item.label)).toEqual([
      "受众",
      "场景",
      "篇幅",
      "结构",
      "风格",
    ]);
    expect(views.every((item) => item.status === "open")).toBe(true);
  });

  it("选中条目保留身份，删除后回落首条，空规格返回 null", () => {
    const entries = [entry("entry-1"), entry("entry-2")];
    expect(resolveSelectedEntryId(entries, "entry-2")).toBe("entry-2");
    expect(resolveSelectedEntryId(entries, "missing")).toBe("entry-1");
    expect(resolveSelectedEntryId([], "entry-1")).toBeNull();
  });
});

describe("唯一主行动", () => {
  it("pending、手工 dirty、对话可发送依次占用唯一 primary", () => {
    expect(
      resolvePlanningPrimaryAction({
        hasPendingProposal: true,
        hasSavedSpec: true,
        dirty: true,
        sidebarView: "conversation",
      }),
    ).toBe("accept");
    expect(
      resolvePlanningPrimaryAction({
        hasPendingProposal: false,
        hasSavedSpec: true,
        dirty: true,
        sidebarView: "conversation",
      }),
    ).toBe("save");
    expect(
      resolvePlanningPrimaryAction({
        hasPendingProposal: false,
        hasSavedSpec: true,
        dirty: false,
        sidebarView: "conversation",
      }),
    ).toBe("send");
    expect(
      resolvePlanningPrimaryAction({
        hasPendingProposal: false,
        hasSavedSpec: true,
        dirty: false,
        sidebarView: "history",
      }),
    ).toBeNull();
  });
});

describe("提案消息状态", () => {
  it("只有 pending 使用待处理语义，接受与拒绝回到完成语义", () => {
    const candidate = spec("新风格", [entry("entry-1")]);
    const message = {
      v: 1 as const,
      kind: "message" as const,
      messageId: "proposal-1",
      at: "2026-08-04T00:00:00.000Z",
      role: "assistant" as const,
      text: "提案",
      dimensions: null,
      proposal: {
        kind: "spec-change" as const,
        raw: {},
        candidate,
        scope: "deck" as const,
      },
      requestId: null,
      model: "test-model",
    };
    const base = { message, proposal: message.proposal, decision: null };

    expect(
      resolveProposalMessageStatus(
        [{ ...base, status: "pending" }],
        "proposal-1",
      ),
    ).toEqual({ label: "提案已显示在右侧，等待你的决定。", pending: true });
    expect(
      resolveProposalMessageStatus(
        [{ ...base, status: "accepted" }],
        "proposal-1",
      ),
    ).toEqual({ label: "提案已接受并写入规格。", pending: false });
    expect(
      resolveProposalMessageStatus(
        [{ ...base, status: "rejected" }],
        "proposal-1",
      ),
    ).toEqual({ label: "提案已拒绝，规格未改动。", pending: false });
  });
});

describe("提案选择与逐字段 diff", () => {
  const before = spec("旧风格", [entry("entry-1"), entry("entry-2")]);
  const candidate = spec("新风格", [
    entry("entry-1", { visualIntent: "中央大图" }),
    entry("entry-2"),
    entry("entry-3"),
  ]);

  it("全 deck 默认只选实际变化的 style 与条目", () => {
    expect(buildDefaultProposalSelection(before, candidate, "deck")).toEqual({
      includeStyle: true,
      specEntryIds: ["entry-1", "entry-3"],
    });
  });

  it("全 deck 可取消 style 或个别条目，未知 id 被剔除", () => {
    expect(
      normalizeProposalSelection(before, candidate, "deck", {
        includeStyle: false,
        specEntryIds: ["entry-3", "unknown"],
      }),
    ).toEqual({ includeStyle: false, specEntryIds: ["entry-3"] });
  });

  it("diff 只省略整条未变化条目，变化条目内部仍保留中性字段", () => {
    const selection = buildDefaultProposalSelection(before, candidate, "deck");
    const sections = buildProposalDiffSections(before, candidate, selection);
    expect(sections.map((section) => section.id)).toEqual([
      "style",
      "entry-1",
      "entry-3",
    ]);
    const entrySection = sections.find((section) => section.id === "entry-1");
    expect(entrySection?.fields.some((field) => !field.changed)).toBe(true);
    expect(
      entrySection?.fields.find((field) => field.field === "visualIntent")
        ?.changed,
    ).toBe(true);
  });
});

describe("接受确认文案", () => {
  it("只说明精确漂移影响，不把保存规格说成付费生成", () => {
    const confirm = buildProposalConfirm({
      willDrift: [driftedPage("page-01")],
      willMiss: [driftedPage("page-02"), driftedPage("page-03")],
    });
    expect(confirm.message).toContain("1 页变为已过时、2 页失联");
    expect(confirm.detail).toContain("不会生成图像");
    expect(confirm.detail).not.toContain("付费");
  });
});

function driftedPage(pageLabel: string) {
  return {
    slideId: `slide-${pageLabel}`,
    pageLabel,
    specEntryId: `entry-${pageLabel}`,
    before: "before",
    after: "after",
  };
}
