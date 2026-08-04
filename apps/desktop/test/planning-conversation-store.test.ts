import type {
  ContentSpec,
  PlanningConversationSnapshot,
  PlanningMessage,
  PlanningProposalPreview,
  PlanningProposalState,
} from "@ppt-maker/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { IpcApi } from "../src/main/ipc/channels.js";
import { usePlanningConversationStore } from "../src/renderer/stores/planning-conversation-store.js";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function spec(style = "旧风格"): ContentSpec {
  return {
    schemaVersion: 1,
    specId: "spec-1",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    style: { description: style },
    entries: [
      {
        specEntryId: "entry-1",
        pageType: "cover",
        textGroups: [{ label: "标题", items: ["策划对话"] }],
        visualIntent: "中央标题",
        revisionNotes: [],
      },
    ],
  };
}

function assistantMessage(
  proposal: PlanningMessage["proposal"] = null,
): PlanningMessage {
  return {
    v: 1,
    kind: "message",
    messageId: proposal === null ? "message-question" : "message-proposal",
    at: "2026-08-04T00:00:00.000Z",
    role: "assistant",
    text: proposal === null ? "这份演示给谁看？" : "我整理了一份提案。",
    proposal,
    dimensions: {
      audience: "open",
      scenario: "resolved",
      length: "open",
      structure: "open",
      style: "open",
    },
    requestId: null,
    model: "test-model",
  };
}

function snapshot(
  deckStyle: string,
  pending: PlanningProposalState | null = null,
): PlanningConversationSnapshot {
  const message = pending?.message ?? assistantMessage();
  return {
    spec: spec(deckStyle),
    materials: [],
    session: {
      messages: [message],
      dimensions: message.dimensions,
      proposals: pending === null ? [] : [pending],
      pendingProposal: pending,
    },
  };
}

function pendingProposal(): PlanningProposalState {
  const candidate = spec("新风格");
  const proposal = {
    kind: "spec-change" as const,
    raw: { reply: "改好了" },
    candidate,
    scope: "deck" as const,
  };
  return {
    message: assistantMessage(proposal),
    proposal,
    status: "pending",
    decision: null,
  };
}

function preview(): PlanningProposalPreview {
  const candidate = spec("新风格");
  return {
    proposalMessageId: "message-proposal",
    candidate,
    diff: {
      styleChanged: true,
      entriesBefore: [],
      entriesAfter: [],
      added: [],
      removed: [],
      modified: [],
      reordered: false,
    },
    willDrift: [],
    willMiss: [],
  };
}

function stubPlanning(planning: Partial<IpcApi["planning"]>): void {
  globalThis.window = { api: { planning } as IpcApi };
}

beforeEach(() => {
  usePlanningConversationStore.getState().reset();
});

describe("按 deck 身份守卫异步响应", () => {
  it("旧 deck 的迟到成功与失败都不污染新 deck", async () => {
    const old = deferred<PlanningConversationSnapshot>();
    const newer = snapshot("新 deck");
    stubPlanning({
      load: (deckPath) =>
        deckPath === "/decks/old" ? old.promise : Promise.resolve(newer),
    });

    const oldLoad = usePlanningConversationStore.getState().load("/decks/old");
    await usePlanningConversationStore.getState().load("/decks/new");
    old.resolve(snapshot("旧 deck"));
    await oldLoad;

    expect(usePlanningConversationStore.getState().deckPath).toBe("/decks/new");
    expect(
      usePlanningConversationStore.getState().snapshot?.spec?.style.description,
    ).toBe("新 deck");
    expect(usePlanningConversationStore.getState().error).toBeNull();
  });

  it("reset(nextDeckPath) 不误伤已属于新 deck 的加载（正对照）", async () => {
    const pending = deferred<PlanningConversationSnapshot>();
    stubPlanning({ load: () => pending.promise });

    const load = usePlanningConversationStore.getState().load("/decks/new");
    usePlanningConversationStore.getState().reset("/decks/new");
    pending.resolve(snapshot("新 deck"));
    await load;

    expect(
      usePlanningConversationStore.getState().snapshot?.spec?.style.description,
    ).toBe("新 deck");
    expect(usePlanningConversationStore.getState().operation).toBeNull();
  });

  it("reset 到另一个身份后，旧 deck 的迟到失败不写错误", async () => {
    const pending = deferred<PlanningConversationSnapshot>();
    stubPlanning({ load: () => pending.promise });

    const load = usePlanningConversationStore.getState().load("/decks/old");
    usePlanningConversationStore.getState().reset("/decks/new");
    pending.reject(new Error("旧 deck 会话损坏"));
    await load;

    expect(usePlanningConversationStore.getState().error).toBeNull();
    expect(usePlanningConversationStore.getState().deckPath).toBe("/decks/new");
  });
});

describe("pending 与提案预览", () => {
  it("重开读到 pending 时恢复默认全选并加载影响预览", async () => {
    const pending = pendingProposal();
    const loaded = snapshot("旧风格", pending);
    let previewArgs: readonly unknown[] = [];
    stubPlanning({
      load: async () => loaded,
      previewProposal: async (...args) => {
        previewArgs = args;
        return preview();
      },
    });

    await usePlanningConversationStore.getState().load("/decks/demo");

    const state = usePlanningConversationStore.getState();
    expect(state.selection).toEqual({ includeStyle: true, specEntryIds: [] });
    expect(state.preview?.proposalMessageId).toBe("message-proposal");
    expect(previewArgs).toEqual([
      "/decks/demo",
      "message-proposal",
      { includeStyle: true, specEntryIds: [] },
    ]);
  });

  it("E5 在 store 层阻止 pending 时继续发送，且不调用 IPC", async () => {
    const loaded = snapshot("旧风格", pendingProposal());
    let sendCalls = 0;
    stubPlanning({
      load: async () => loaded,
      previewProposal: async () => preview(),
      sendMessage: async () => {
        sendCalls += 1;
        return loaded;
      },
    });
    await usePlanningConversationStore.getState().load("/decks/demo");

    await expect(
      usePlanningConversationStore.getState().sendMessage("继续改"),
    ).resolves.toBe(false);
    expect(sendCalls).toBe(0);
    expect(usePlanningConversationStore.getState().error).toContain(
      "接受或拒绝",
    );
  });

  it("提案选择变化后预览失败时清空旧预览，不能用旧影响数继续接受", async () => {
    const loaded = snapshot("旧风格", pendingProposal());
    let previewCalls = 0;
    stubPlanning({
      load: async () => loaded,
      previewProposal: async () => {
        previewCalls += 1;
        if (previewCalls === 1) return preview();
        throw new Error("preview failed");
      },
    });
    await usePlanningConversationStore.getState().load("/decks/demo");
    expect(usePlanningConversationStore.getState().preview).not.toBeNull();

    await usePlanningConversationStore.getState().setProposalSelection({
      includeStyle: false,
      specEntryIds: [],
    });

    expect(usePlanningConversationStore.getState().preview).toBeNull();
    expect(usePlanningConversationStore.getState().error).toContain(
      "提案影响预览失败",
    );
  });
});

describe("材料副本", () => {
  it("导入取消不改列表，成功时按文件名稳定排序", async () => {
    let call = 0;
    stubPlanning({
      load: async () => ({
        ...snapshot("风格"),
        materials: [{ name: "b.md", sizeBytes: 2 }],
      }),
      importMaterial: async () => {
        call += 1;
        return call === 1 ? null : { name: "a.txt", sizeBytes: 1 };
      },
    });
    await usePlanningConversationStore.getState().load("/decks/demo");

    await usePlanningConversationStore.getState().importMaterial();
    expect(
      usePlanningConversationStore
        .getState()
        .snapshot?.materials.map((item) => item.name),
    ).toEqual(["b.md"]);

    await usePlanningConversationStore.getState().importMaterial();
    expect(
      usePlanningConversationStore
        .getState()
        .snapshot?.materials.map((item) => item.name),
    ).toEqual(["a.txt", "b.md"]);
  });
});
