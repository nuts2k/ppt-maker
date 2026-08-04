import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeckWorkspace } from "@cli/deck/workspace.js";
import type { ContentSpec } from "@ppt-maker/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityLog } from "../src/main/activity-log.js";
import { registerDeckHandlers } from "../src/main/ipc/deck.js";

const handlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>(),
);

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function nextSpec(): ContentSpec {
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
        textGroups: [{ label: "标题", items: ["内容策划工作台"] }],
        visualIntent: "居中大标题",
        revisionNotes: [],
      },
    ],
  };
}

function registered(channel: string): (...args: unknown[]) => unknown {
  const handler = handlers.get(channel);
  if (handler === undefined) throw new Error(`IPC handler 未注册：${channel}`);
  return handler;
}

beforeEach(async () => {
  handlers.clear();
  const activityDir = await mkdtemp(join(tmpdir(), "planning-ipc-log-"));
  registerDeckHandlers(
    { isRunning: () => false } as never,
    { isRunning: () => false } as never,
    new ActivityLog(activityDir),
  );
});

describe("策划 IPC 写入边界", () => {
  it("Deck 名称不能越出用户选择的父目录", async () => {
    const create = registered("deck:create-empty");
    await expect(
      Promise.resolve(create(undefined, "/tmp/selected", "../escaped")),
    ).rejects.toThrow("Deck 名称不能为空，也不能包含路径分隔符");
  });

  it("拒绝空白变更摘要，避免写出无法读取的历史行", async () => {
    const save = registered("deck:apply-spec-change");
    await expect(
      Promise.resolve(save(undefined, "/tmp/deck", nextSpec(), "   ")),
    ).rejects.toThrow("规格变更摘要不能为空");
  });

  it("建页任务执行期间拒绝规格写入", async () => {
    handlers.clear();
    const activityDir = await mkdtemp(join(tmpdir(), "planning-ipc-log-"));
    registerDeckHandlers(
      { isRunning: () => false } as never,
      { isRunning: () => true } as never,
      new ActivityLog(activityDir),
    );

    const save = registered("deck:apply-spec-change");
    await expect(
      Promise.resolve(save(undefined, "/tmp/deck", nextSpec(), "更新规格")),
    ).rejects.toThrow("建页任务正在执行");

    const exportDeck = registered("deck:export");
    await expect(
      Promise.resolve(
        exportDeck(undefined, "/tmp/deck", "/tmp/output.pptx", false),
      ),
    ).rejects.toThrow("建页任务正在执行");

    const create = registered("deck:create-empty");
    await expect(
      Promise.resolve(create(undefined, "/tmp", "planning-new")),
    ).rejects.toThrow("结束后才能新建空 Deck");
  });
});

describe("规格保存失败的坏页上下文", () => {
  it("一页 manifest 损坏时点名页标签，不只返回底层解析错误", async () => {
    const base = await mkdtemp(join(tmpdir(), "planning-ipc-"));
    const deck = await createDeckWorkspace({
      imagesDir: join(projectRoot, "fixtures", "single-slide"),
      workspacePath: join(base, "deck"),
      name: "planning-ipc-fixture",
    });
    await writeFile(
      join(deck.path, "slides", "page-01", "manifest.json"),
      "{ 这不是 JSON",
      "utf8",
    );

    const save = registered("deck:apply-spec-change");
    await expect(
      Promise.resolve(save(undefined, deck.path, nextSpec(), "更新规格")),
    ).rejects.toThrow("page-01 的页面数据损坏");
  });
});
