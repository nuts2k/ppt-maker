import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type {
  ContentSpec,
  ContentSpecDraft,
  PlanningDimensions,
  SpecProposal,
} from "@ppt-maker/core";
import { describe, expect, it, vi } from "vitest";
import { loadDeckContentSpec } from "../src/deck/content-spec.js";
import {
  createPlanningConversationService,
  type PlanningConversationDependencyOverrides,
} from "../src/deck/planning-conversation.js";
import {
  appendPlanningSessionRecords,
  DECK_SPEC_HISTORY_PATH,
  listPlanningSessionRecords,
} from "../src/deck/planning-store.js";
import { applySpecChange, previewSpecChange } from "../src/deck/spec-edit.js";
import { createEmptyDeckWorkspace } from "../src/deck/workspace.js";

const NOW = "2026-08-04T12:00:00.000Z";
const DIMENSIONS: PlanningDimensions = {
  audience: "resolved",
  scenario: "resolved",
  length: "open",
  structure: "open",
  style: "open",
};

const DRAFT: ContentSpecDraft = {
  style: { description: "克制的深蓝科技风，信息密度中等" },
  entries: [
    {
      pageType: "cover",
      textGroups: [{ label: "标题", items: ["季度经营复盘"] }],
      visualIntent: "居中大标题，背景使用抽象数据网格",
    },
    {
      pageType: "summary",
      textGroups: [{ label: "标题", items: ["关键结论"] }],
      visualIntent: "三列结论卡片",
    },
  ],
};

async function emptyDeck(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-conversation-"));
  const deckPath = join(parent, "deck");
  await createEmptyDeckWorkspace({ workspacePath: deckPath });
  return deckPath;
}

function ids(): Pick<
  PlanningConversationDependencyOverrides,
  "createId" | "createSpecEntryId" | "now"
> {
  let next = 0;
  return {
    now: () => NOW,
    createId: () => `id-${String(++next).padStart(3, "0")}`,
    createSpecEntryId: (index) => `entry-${String(index + 1).padStart(3, "0")}`,
  };
}

function fakeDraft() {
  return {
    requestId: "request-draft",
    model: "controlled-model",
    result: DRAFT,
  };
}

function fakeQuestion(reply = "我已理解，下一步确认篇幅。") {
  return {
    requestId: null,
    model: "controlled-model",
    result: {
      reply,
      dimensions: DIMENSIONS,
      nextQuestion: "预计需要多少页？",
      canDraft: true,
    },
  };
}

async function seedSpec(deckPath: string): Promise<ContentSpec> {
  const spec: ContentSpec = {
    schemaVersion: 1,
    specId: "spec-seed",
    createdAt: NOW,
    updatedAt: NOW,
    style: { description: "原始黑白编辑风" },
    entries: [
      {
        specEntryId: "entry-001",
        pageType: "cover",
        textGroups: [{ label: "标题", items: ["原始封面"] }],
        visualIntent: "左对齐标题",
        revisionNotes: [],
      },
      {
        specEntryId: "entry-002",
        pageType: "content",
        textGroups: [{ label: "标题", items: ["原始正文"] }],
        visualIntent: "上下结构",
        revisionNotes: [],
      },
    ],
  };
  return (
    await applySpecChange({
      deckPath,
      nextSpec: spec,
      origin: "manual",
      summary: "测试基线规格",
      now: () => NOW,
    })
  ).spec;
}

function changedEntryProposal(): SpecProposal {
  return {
    reply: "将封面标题改得更聚焦。",
    styleProposal: null,
    entryProposals: [
      {
        specEntryId: "entry-001",
        remove: false,
        pageType: "cover",
        textGroups: [{ label: "标题", items: ["增长质量复盘"] }],
        visualIntent: "左对齐标题",
        revisionNotes: [],
      },
    ],
  };
}

describe("planning conversation service", () => {
  it("多轮消息一次追加 user + assistant，并从最新 assistant 重建维度", async () => {
    const deckPath = await emptyDeck();
    const askQuestion = vi.fn(async () => fakeQuestion());
    const service = createPlanningConversationService({
      ...ids(),
      askQuestion,
    });

    await service.sendMessage(deckPath, "给研发负责人做季度复盘");
    const snapshot = await service.sendMessage(deckPath, "控制在十页左右");

    expect(snapshot.session.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(snapshot.session.dimensions).toEqual(DIMENSIONS);
    expect(snapshot.session.messages[1]?.text).toContain("预计需要多少页？");
    expect(askQuestion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        history: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "给研发负责人做季度复盘",
          }),
        ]),
      }),
    );
  });

  it("初稿先留痕且确认前无规格；全量接受后 origin/conversationRef 正确", async () => {
    const deckPath = await emptyDeck();
    const previewChange = vi.fn(previewSpecChange);
    const service = createPlanningConversationService({
      ...ids(),
      draftSpec: async () => fakeDraft(),
      previewChange,
    });

    const proposed = await service.draftSpec(deckPath);
    expect(await loadDeckContentSpec(deckPath)).toBeNull();
    expect(
      proposed.snapshot.session.pendingProposal?.proposal.candidate,
    ).toEqual(proposed.preview.candidate);
    expect(
      proposed.preview.candidate.entries.map((entry) => entry.specEntryId),
    ).toEqual(["entry-001", "entry-002"]);

    const proposalMessageId = proposed.preview.proposalMessageId;
    const accepted = await service.acceptProposal(deckPath, proposalMessageId, {
      includeStyle: true,
      specEntryIds: ["entry-001", "entry-002"],
    });

    expect(accepted.decisionWritten).toBe(true);
    expect(previewChange).toHaveBeenCalledTimes(2);
    expect(accepted.applyResult.record.origin).toBe("proposal");
    expect(accepted.applyResult.record.conversationRef).toBe(proposalMessageId);
    expect(accepted.snapshot.session.pendingProposal).toBeNull();
    expect(accepted.snapshot.session.proposals[0]?.status).toBe("accepted");
    expect(await loadDeckContentSpec(deckPath)).toEqual(
      accepted.applyResult.spec,
    );
  });

  it("pending 存在时领域层阻止继续发送和再次提案", async () => {
    const deckPath = await emptyDeck();
    const service = createPlanningConversationService({
      ...ids(),
      draftSpec: async () => fakeDraft(),
      askQuestion: async () => fakeQuestion(),
    });
    await service.draftSpec(deckPath);

    await expect(service.sendMessage(deckPath, "继续改")).rejects.toMatchObject(
      {
        code: "INVALID_STAGE_STATE",
      },
    );
    await expect(service.draftSpec(deckPath)).rejects.toMatchObject({
      code: "INVALID_STAGE_STATE",
    });
  });

  it("同一 deck 并发出稿仍只产生一个 pending", async () => {
    const deckPath = await emptyDeck();
    const draftSpec = vi.fn(async () => fakeDraft());
    const service = createPlanningConversationService({
      ...ids(),
      draftSpec,
    });

    const results = await Promise.allSettled([
      service.draftSpec(deckPath),
      service.draftSpec(deckPath),
    ]);
    const snapshot = await service.load(deckPath);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(draftSpec).toHaveBeenCalledTimes(1);
    expect(snapshot.session.proposals).toHaveLength(1);
    expect(snapshot.session.pendingProposal).not.toBeNull();
  });

  it("同一 deck 的等价路径共用串行队列，不能绕过唯一 pending", async () => {
    const deckPath = await emptyDeck();
    let releaseProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const draftSpec = vi.fn(async () => {
      await providerGate;
      return fakeDraft();
    });
    const service = createPlanningConversationService({
      ...ids(),
      draftSpec,
    });

    const first = service.draftSpec(deckPath);
    const second = service.draftSpec(`${deckPath}${sep}`);
    await vi.waitFor(() => expect(draftSpec).toHaveBeenCalledTimes(1));
    releaseProvider?.();

    const results = await Promise.allSettled([first, second]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(draftSpec).toHaveBeenCalledTimes(1);
  });

  it("拒绝只追加 decision，规格文件字节保持不变", async () => {
    const deckPath = await emptyDeck();
    await seedSpec(deckPath);
    const service = createPlanningConversationService({
      ...ids(),
      proposeChange: async () => ({
        requestId: "request-entry",
        model: "controlled-model",
        result: changedEntryProposal(),
      }),
    });
    const proposed = await service.proposeChange(deckPath, "封面标题更聚焦", {
      kind: "entry",
      targetSpecEntryId: "entry-001",
    });
    const before = await readFile(join(deckPath, "content-spec.json"));

    const rejected = await service.rejectProposal(
      deckPath,
      proposed.preview.proposalMessageId,
    );
    const after = await readFile(join(deckPath, "content-spec.json"));

    expect(after.equals(before)).toBe(true);
    expect(rejected.session.proposals[0]?.status).toBe("rejected");
    const records = await listPlanningSessionRecords(deckPath);
    expect(records.some((record) => record.kind === "proposal-decision")).toBe(
      true,
    );
  });

  it("全 deck 可取消 style 与个别条目，只落盘被选部分", async () => {
    const deckPath = await emptyDeck();
    const before = await seedSpec(deckPath);
    const proposal: SpecProposal = {
      reply: "统一优化两页并调整风格。",
      styleProposal: "高饱和霓虹风",
      entryProposals: before.entries.map((entry, index) => ({
        ...entry,
        remove: false,
        textGroups: [
          { label: "标题", items: [`改后第 ${String(index + 1)} 页`] },
        ],
      })),
    };
    const service = createPlanningConversationService({
      ...ids(),
      proposeChange: async () => ({
        requestId: "request-deck",
        model: "controlled-model",
        result: proposal,
      }),
    });
    const proposed = await service.proposeChange(deckPath, "整体更简洁", {
      kind: "deck",
    });

    await service.acceptProposal(deckPath, proposed.preview.proposalMessageId, {
      includeStyle: false,
      specEntryIds: ["entry-001"],
    });
    const onDisk = await loadDeckContentSpec(deckPath);

    expect(onDisk?.style).toEqual(before.style);
    expect(onDisk?.entries[0]?.textGroups[0]?.items).toEqual(["改后第 1 页"]);
    expect(onDisk?.entries[1]).toEqual(before.entries[1]);
  });

  it("提案会话追加失败时不返回可接受提案，也不留下半轮", async () => {
    const deckPath = await emptyDeck();
    await seedSpec(deckPath);
    const service = createPlanningConversationService({
      ...ids(),
      proposeChange: async () => ({
        requestId: "request-entry",
        model: "controlled-model",
        result: changedEntryProposal(),
      }),
      appendRecords: async () => {
        throw new Error("session append failed");
      },
    });

    await expect(
      service.proposeChange(deckPath, "封面标题更聚焦", {
        kind: "entry",
        targetSpecEntryId: "entry-001",
      }),
    ).rejects.toThrow("session append failed");
    expect(await listPlanningSessionRecords(deckPath)).toEqual([]);
  });

  it("accepted decision 写失败后重开，规格历史仍把提案恢复为 accepted", async () => {
    const deckPath = await emptyDeck();
    await seedSpec(deckPath);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = createPlanningConversationService({
      ...ids(),
      proposeChange: async () => ({
        requestId: "request-entry",
        model: "controlled-model",
        result: changedEntryProposal(),
      }),
      appendRecords: async (path, records) => {
        if (records[0]?.kind === "proposal-decision") {
          throw new Error("decision append failed");
        }
        await appendPlanningSessionRecords(path, records);
      },
    });
    const proposed = await service.proposeChange(deckPath, "封面标题更聚焦", {
      kind: "entry",
      targetSpecEntryId: "entry-001",
    });

    const result = await service.acceptProposal(
      deckPath,
      proposed.preview.proposalMessageId,
      { includeStyle: false, specEntryIds: ["entry-001"] },
    );

    expect(result.decisionWritten).toBe(false);
    expect(result.applyResult.record.conversationRef).toBe(
      proposed.preview.proposalMessageId,
    );
    expect(
      (await loadDeckContentSpec(deckPath))?.entries[0]?.textGroups[0]?.items,
    ).toEqual(["增长质量复盘"]);
    expect(result.snapshot.session.pendingProposal).toBeNull();
    expect(result.snapshot.session.proposals[0]?.status).toBe("accepted");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();

    // 模拟关闭当前窗口后用全新 service 重开；session.jsonl 仍没有 decision，
    // 但 spec-history 的 conversationRef 是 applySpecChange 成功的耐久证据。
    const reopened = createPlanningConversationService(ids());
    const recovered = await reopened.load(deckPath);
    expect(recovered.session.pendingProposal).toBeNull();
    expect(recovered.session.proposals[0]?.status).toBe("accepted");
    expect(recovered.session.proposals[0]?.decision?.acceptedAs).toBe(
      result.applyResult.record.recordId,
    );
  });

  it("规格历史与 accepted decision 同时写失败时保留 pending，不凭规格相等猜测", async () => {
    const deckPath = await emptyDeck();
    await seedSpec(deckPath);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = createPlanningConversationService({
      ...ids(),
      proposeChange: async () => ({
        requestId: "request-entry",
        model: "controlled-model",
        result: changedEntryProposal(),
      }),
      applyChange: async (options) => {
        const result = await applySpecChange(options);
        // 模拟 applySpecChange 已写成规格，但旁路 historyWritten=false：测试里
        // 删除刚写的历史行来复现“没有 conversationRef 证据”的可观察状态。
        await rm(join(deckPath, DECK_SPEC_HISTORY_PATH));
        return { ...result, historyWritten: false };
      },
      appendRecords: async (path, records) => {
        if (records[0]?.kind === "proposal-decision") {
          throw new Error("decision append failed");
        }
        await appendPlanningSessionRecords(path, records);
      },
    });
    const proposed = await service.proposeChange(deckPath, "封面标题更聚焦", {
      kind: "entry",
      targetSpecEntryId: "entry-001",
    });

    const result = await service.acceptProposal(
      deckPath,
      proposed.preview.proposalMessageId,
      { includeStyle: false, specEntryIds: ["entry-001"] },
    );

    expect(result.applyResult.historyWritten).toBe(false);
    expect(result.decisionWritten).toBe(false);
    expect(result.snapshot.session.pendingProposal?.message.messageId).toBe(
      proposed.preview.proposalMessageId,
    );
    expect(result.snapshot.session.proposals[0]?.status).toBe("pending");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("每轮重新读取当前材料：导入后生效，移除后停止使用", async () => {
    const deckPath = await emptyDeck();
    const sourcePath = join(
      await mkdtemp(join(tmpdir(), "ppt-material-")),
      "brief.md",
    );
    await writeFile(sourcePath, "目标受众：研发负责人", "utf8");
    const contexts: string[] = [];
    const service = createPlanningConversationService({
      ...ids(),
      askQuestion: async (options) => {
        contexts.push(options.materialsContext);
        return fakeQuestion();
      },
    });

    const imported = await service.importMaterial(deckPath, sourcePath);
    await service.sendMessage(deckPath, "先讨论结构");
    await service.removeMaterial(deckPath, imported.name);
    await service.sendMessage(deckPath, "再讨论风格");

    expect(contexts[0]).toContain("brief.md");
    expect(contexts[0]).toContain("目标受众：研发负责人");
    expect(contexts[1]).toBe("");
    expect(await readFile(sourcePath, "utf8")).toBe("目标受众：研发负责人");
  });
});
