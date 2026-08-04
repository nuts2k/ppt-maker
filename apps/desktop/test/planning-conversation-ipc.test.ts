import { readFileSync } from "node:fs";
import type {
  ContentSpec,
  PlanningAcceptProposalResult,
  PlanningConversationSnapshot,
  PlanningProposalResult,
} from "@ppt-maker/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcApi } from "../src/main/ipc/channels.js";
import {
  type PlanningIpcService,
  registerPlanningHandlers,
} from "../src/main/ipc/planning.js";

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  invoke: vi.fn(),
  exposedApi: null as unknown,
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler);
    },
  },
  dialog: { showOpenDialog: electron.showOpenDialog },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      electron.exposedApi = api;
    },
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

function spec(): ContentSpec {
  return {
    schemaVersion: 1,
    specId: "spec-1",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    style: { description: "克制的编辑部校样风" },
    entries: [
      {
        specEntryId: "entry-001",
        pageType: "cover",
        textGroups: [{ label: "标题", items: ["策划对话"] }],
        visualIntent: "居中大标题",
        revisionNotes: [],
      },
    ],
  };
}

function snapshot(): PlanningConversationSnapshot {
  return {
    session: {
      messages: [],
      dimensions: null,
      proposals: [],
      pendingProposal: null,
    },
    spec: spec(),
    materials: [],
  };
}

function proposalResult(): PlanningProposalResult {
  return {
    snapshot: snapshot(),
    preview: {
      proposalMessageId: "proposal-1",
      candidate: spec(),
      diff: {
        styleChanged: false,
        entriesBefore: [],
        entriesAfter: [],
        added: [],
        removed: [],
        modified: [],
        reordered: false,
      },
      willDrift: [],
      willMiss: [],
    },
  };
}

function acceptResult(): PlanningAcceptProposalResult {
  const current = spec();
  return {
    snapshot: snapshot(),
    applyResult: {
      spec: current,
      record: {
        v: 1,
        recordId: "record-1",
        at: "2026-08-04T01:00:00.000Z",
        origin: "proposal",
        summary: "接受策划提案",
        styleBefore: current.style,
        styleAfter: current.style,
        entriesBefore: [],
        entriesAfter: [],
        fingerprints: [],
        conversationRef: "proposal-1",
        rollbackOf: null,
      },
      historyWritten: true,
      drifted: [],
      missing: [],
    },
    decisionWritten: true,
  };
}

function service(): PlanningIpcService & {
  [K in keyof PlanningIpcService]: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn(async () => snapshot()),
    sendMessage: vi.fn(async () => snapshot()),
    draftSpec: vi.fn(async () => proposalResult()),
    proposeChange: vi.fn(async () => proposalResult()),
    previewProposal: vi.fn(async () => proposalResult().preview),
    acceptProposal: vi.fn(async () => acceptResult()),
    rejectProposal: vi.fn(async () => snapshot()),
    listMaterials: vi.fn(async () => []),
    importMaterial: vi.fn(async () => ({ name: "brief.md", sizeBytes: 12 })),
    removeMaterial: vi.fn(async () => undefined),
  };
}

function registered(channel: string): (...args: unknown[]) => unknown {
  const handler = electron.handlers.get(channel);
  if (handler === undefined) throw new Error(`IPC handler 未注册：${channel}`);
  return handler;
}

function register(
  planningService: PlanningIpcService,
  pipelineRunning = false,
  sourceTaskRunning = false,
): void {
  registerPlanningHandlers(
    { isRunning: () => pipelineRunning },
    { isRunning: () => sourceTaskRunning },
    planningService,
  );
}

beforeEach(() => {
  electron.handlers.clear();
  electron.showOpenDialog.mockReset();
  electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  electron.invoke.mockReset();
  electron.invoke.mockResolvedValue(undefined);
});

describe("策划 IPC 注册与 schema 边界", () => {
  it("main 生命周期只注册一次 planning handlers", () => {
    const source = readFileSync(
      new URL("../src/main/index.ts", import.meta.url),
      "utf8",
    );
    expect(source.match(/registerPlanningHandlers\(/g)).toHaveLength(1);
    expect(source).toContain("registerPlanningHandlers(runner, sourceTasks)");
  });

  it("注册完整 planning namespace", () => {
    register(service());
    expect([...electron.handlers.keys()].sort()).toEqual(
      [
        "planning:accept-proposal",
        "planning:draft-spec",
        "planning:import-material",
        "planning:list-materials",
        "planning:load",
        "planning:preview-proposal",
        "planning:propose-change",
        "planning:reject-proposal",
        "planning:remove-material",
        "planning:send-message",
      ].sort(),
    );
  });

  it("无效 scope 与空提案 id 在调用领域服务前被拒绝", async () => {
    const planningService = service();
    register(planningService);

    await expect(
      Promise.resolve(
        registered("planning:propose-change")(
          undefined,
          "/tmp/deck",
          "缩短第三页",
          { kind: "entry", targetSpecEntryId: "" },
        ),
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(
        registered("planning:reject-proposal")(undefined, "/tmp/deck", ""),
      ),
    ).rejects.toThrow();

    expect(planningService.proposeChange).not.toHaveBeenCalled();
    expect(planningService.rejectProposal).not.toHaveBeenCalled();
  });

  it("坏的领域返回值不会跨进程进入 renderer", async () => {
    const planningService = service();
    planningService.load.mockResolvedValue({ spec: null });
    register(planningService);

    await expect(
      Promise.resolve(registered("planning:load")(undefined, "/tmp/deck")),
    ).rejects.toThrow();
  });

  it("Provider 错误保持原因向上传递", async () => {
    const planningService = service();
    planningService.sendMessage.mockRejectedValue(
      new Error("INVALID_PROVIDER_RESPONSE: 模型拒绝回答"),
    );
    register(planningService);

    await expect(
      Promise.resolve(
        registered("planning:send-message")(
          undefined,
          "/tmp/deck",
          "做一份发布会演示",
        ),
      ),
    ).rejects.toThrow("INVALID_PROVIDER_RESPONSE: 模型拒绝回答");
  });
});

describe("策划 preload 转发", () => {
  it("planning namespace 的十个动作逐条转到对应 channel", async () => {
    await import("../src/preload/index.js");
    const api = (electron.exposedApi as IpcApi).planning;
    const selection = { includeStyle: true, specEntryIds: ["entry-001"] };
    const scope = { kind: "entry", targetSpecEntryId: "entry-001" } as const;

    await api.load("/tmp/deck");
    await api.sendMessage("/tmp/deck", "继续");
    await api.draftSpec("/tmp/deck");
    await api.proposeChange("/tmp/deck", "缩短", scope);
    await api.previewProposal("/tmp/deck", "proposal-1", selection);
    await api.acceptProposal("/tmp/deck", "proposal-1", selection);
    await api.rejectProposal("/tmp/deck", "proposal-1");
    await api.listMaterials("/tmp/deck");
    await api.importMaterial("/tmp/deck");
    await api.removeMaterial("/tmp/deck", "brief.md");

    expect(electron.invoke.mock.calls.map((call) => call[0])).toEqual([
      "planning:load",
      "planning:send-message",
      "planning:draft-spec",
      "planning:propose-change",
      "planning:preview-proposal",
      "planning:accept-proposal",
      "planning:reject-proposal",
      "planning:list-materials",
      "planning:import-material",
      "planning:remove-material",
    ]);
    expect(electron.invoke).toHaveBeenCalledWith(
      "planning:propose-change",
      "/tmp/deck",
      "缩短",
      scope,
    );
    expect(electron.invoke).toHaveBeenCalledWith(
      "planning:accept-proposal",
      "/tmp/deck",
      "proposal-1",
      selection,
    );
  });
});

describe("策划提案决策与执行任务互斥", () => {
  it.each([
    [true, false, "流水线正在执行"],
    [false, true, "建页任务正在执行"],
  ] as const)(
    "accept/reject 在 runner 状态 %s/%s 时均被拒绝",
    async (pipelineRunning, sourceTaskRunning, message) => {
      const planningService = service();
      register(planningService, pipelineRunning, sourceTaskRunning);
      const selection = { includeStyle: true, specEntryIds: ["entry-001"] };

      await expect(
        Promise.resolve(
          registered("planning:accept-proposal")(
            undefined,
            "/tmp/deck",
            "proposal-1",
            selection,
          ),
        ),
      ).rejects.toThrow(message);
      await expect(
        Promise.resolve(
          registered("planning:reject-proposal")(
            undefined,
            "/tmp/deck",
            "proposal-1",
          ),
        ),
      ).rejects.toThrow(message);
      expect(planningService.acceptProposal).not.toHaveBeenCalled();
      expect(planningService.rejectProposal).not.toHaveBeenCalled();
    },
  );

  it("空闲时接受结果保留 proposal 来源与 conversationRef", async () => {
    const planningService = service();
    register(planningService);

    const result = (await registered("planning:accept-proposal")(
      undefined,
      "/tmp/deck",
      "proposal-1",
      { includeStyle: true, specEntryIds: ["entry-001"] },
    )) as PlanningAcceptProposalResult;

    expect(result.applyResult.record).toMatchObject({
      origin: "proposal",
      conversationRef: "proposal-1",
    });
  });

  it("拒绝只调用 reject 动作，不会误走接受写盘入口", async () => {
    const planningService = service();
    register(planningService);

    await registered("planning:reject-proposal")(
      undefined,
      "/tmp/deck",
      "proposal-1",
    );

    expect(planningService.rejectProposal).toHaveBeenCalledWith(
      "/tmp/deck",
      "proposal-1",
    );
    expect(planningService.acceptProposal).not.toHaveBeenCalled();
  });
});

describe("策划材料文件边界", () => {
  it("文件框只列出 Markdown 与纯文本", async () => {
    const planningService = service();
    register(planningService);

    await registered("planning:import-material")(undefined, "/tmp/deck");

    expect(electron.showOpenDialog).toHaveBeenCalledWith({
      properties: ["openFile"],
      filters: [{ name: "策划材料", extensions: ["md", "txt"] }],
    });
    expect(planningService.importMaterial).not.toHaveBeenCalled();
  });

  it("即使原生框返回二进制格式也在 main 边界拒绝", async () => {
    const planningService = service();
    electron.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/brief.docx"],
    });
    register(planningService);

    await expect(
      Promise.resolve(
        registered("planning:import-material")(undefined, "/tmp/deck"),
      ),
    ).rejects.toThrow("只支持 .md 或 .txt");
    expect(planningService.importMaterial).not.toHaveBeenCalled();
  });

  it("材料读错由领域服务明确报出，不吞成空列表", async () => {
    const planningService = service();
    planningService.listMaterials.mockRejectedValue(
      new Error("材料读取失败：broken.md"),
    );
    register(planningService);

    await expect(
      Promise.resolve(
        registered("planning:list-materials")(undefined, "/tmp/deck"),
      ),
    ).rejects.toThrow("材料读取失败：broken.md");
  });
});
