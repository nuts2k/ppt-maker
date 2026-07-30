import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeckWorkspace } from "@cli/deck/workspace.js";
import type { BrowserWindow } from "electron";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActivityLog } from "../src/main/activity-log.js";
import { resolveDeckContext } from "../src/main/deck-context.js";
import type { DeckRunEvent } from "../src/main/ipc/channels.js";
import { DeckRunner } from "../src/main/runner/deck-runner.js";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const fixturesDir = join(projectRoot, "fixtures", "single-slide");

/**
 * 用假窗口收集 IPC 事件——DeckRunner 只把 BrowserWindow 当作事件出口，
 * 运行时不依赖 Electron，因此可在纯 Node 下驱动真实流水线。
 */
function createEventCollector(): {
  events: DeckRunEvent[];
  getWindow: () => BrowserWindow | null;
} {
  const events: DeckRunEvent[] = [];
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (_channel: string, event: DeckRunEvent) => {
        events.push(event);
      },
    },
  } as unknown as BrowserWindow;
  return { events, getWindow: () => fakeWindow };
}

function waitForRunDone(events: DeckRunEvent[]): Promise<void> {
  return new Promise((resolvePromise) => {
    const timer = setInterval(() => {
      if (events.some((event) => event.kind === "run-done")) {
        clearInterval(timer);
        resolvePromise();
      }
    }, 50);
  });
}

async function createFixtureDeck(): Promise<{
  deckPath: string;
  activityDir: string;
}> {
  const base = await mkdtemp(join(tmpdir(), "deck-runner-"));
  const deck = await createDeckWorkspace({
    imagesDir: fixturesDir,
    workspacePath: join(base, "deck"),
    name: "runner-fixture",
  });
  return { deckPath: deck.path, activityDir: join(base, "activity") };
}

describe("DeckRunner 端到端", () => {
  // CLI 的 OCR 阶段按 process.cwd() 解析原生 Vision 二进制，
  // 与 Electron main 进程启动时 chdir 到项目根的行为保持一致
  const originalCwd = process.cwd();
  beforeAll(() => process.chdir(projectRoot));
  afterAll(() => process.chdir(originalCwd));

  it("批量执行走到 assist-review 的 API 门并落盘活动日志", {
    timeout: 120_000,
  }, async () => {
    const { deckPath, activityDir } = await createFixtureDeck();
    const activityLog = new ActivityLog(activityDir);
    const { events, getWindow } = createEventCollector();
    const runner = new DeckRunner(getWindow, activityLog);

    const started = await runner.start(deckPath, {});
    expect(started.accepted).toBe(true);
    expect(started.queued).toBe(1);
    expect(runner.isRunning()).toBe(true);

    await waitForRunDone(events);

    // 事件序列：run-start → page-start → 逐阶段 → page-done → run-done
    const kinds = events.map((event) => event.kind);
    expect(kinds[0]).toBe("run-start");
    expect(kinds[1]).toBe("page-start");
    expect(kinds.at(-1)).toBe("run-done");
    expect(kinds.at(-2)).toBe("page-done");

    const completedStages = events
      .filter((event) => event.kind === "stage-complete")
      .map((event) => event.stage);
    expect(completedStages).toContain("ocr");
    expect(completedStages).toContain("review");

    // 未传 confirmApi，应停在 assist-review 的 API 门而非失败
    const pageDone = events.find((event) => event.kind === "page-done");
    expect(pageDone).toMatchObject({
      gate: "api",
      stoppedAt: "assist-review",
      error: null,
    });

    const runDone = events.find((event) => event.kind === "run-done");
    expect(runDone).toMatchObject({
      summary: { total: 1, completed: 0, gated: 1, failed: 0 },
    });

    expect(runner.isRunning()).toBe(false);

    // 活动日志按 deckId 落盘，且能反查到 deck 上下文
    const context = await resolveDeckContext(
      join(deckPath, "slides", "page-1"),
    );
    expect(context).not.toBeNull();
    expect(context?.deckPath).toBe(deckPath);

    const records = await activityLog.list(context?.deckId ?? "", 100);
    expect(records.length).toBeGreaterThan(0);
    expect(records.map((r) => r.kind)).toContain("stage-complete");
    expect(records.map((r) => r.kind)).toContain("run-done");
    const ocrRecord = records.find((r) => r.stage === "ocr");
    expect(ocrRecord?.durationMs).toBeGreaterThanOrEqual(0);

    // 停在人工门的记录带闸门前缀且 result 为 gate（不是 failure）——
    // 前缀文案与 renderer 的即时记录同源（shared/gates.ts）
    const pageDoneRecord = records.find((r) => r.kind === "page-done");
    expect(pageDoneRecord?.result).toBe("gate");
    expect(pageDoneRecord?.detail).toContain("停在 API 调用确认：");
  });

  it("断点续跑：二次执行不重做已完成阶段", { timeout: 120_000 }, async () => {
    const { deckPath, activityDir } = await createFixtureDeck();
    const activityLog = new ActivityLog(activityDir);

    const first = createEventCollector();
    const runner1 = new DeckRunner(first.getWindow, activityLog);
    await runner1.start(deckPath, {});
    await waitForRunDone(first.events);

    const second = createEventCollector();
    const runner2 = new DeckRunner(second.getWindow, activityLog);
    await runner2.start(deckPath, {});
    await waitForRunDone(second.events);

    // 第二轮从 assist-review 续跑，不应重跑 ocr
    const secondRunStages = second.events
      .filter((event) => event.kind === "stage-start")
      .map((event) => event.stage);
    expect(secondRunStages).not.toContain("ocr");
    expect(secondRunStages).not.toContain("review");
  });

  /*
   * report 移出可见序列前，显式点名一个已全部完成的页会兜底成 from = "report"，
   * 于是「运行此页」在完成页上总有反应、总是只重跑一遍报告。移除后它必须干脆地
   * 说「无需执行」——真正让完成页重新跑得动的是保存复核的粒度失效。
   */
  it("已全部完成的页被显式点名时不入队", async () => {
    const { deckPath, activityDir } = await createFixtureDeck();
    const deckManifest = JSON.parse(
      await readFile(join(deckPath, "deck-manifest.json"), "utf8"),
    );
    const entry = deckManifest.slides[0];
    const slideManifestPath = join(
      deckPath,
      entry.workspacePath,
      "manifest.json",
    );
    const slideManifest = JSON.parse(await readFile(slideManifestPath, "utf8"));
    slideManifest.stages = slideManifest.stages.map(
      (state: { status: string }) => ({ ...state, status: "completed" }),
    );
    await writeFile(
      slideManifestPath,
      JSON.stringify(slideManifest, null, 2),
      "utf8",
    );

    const { getWindow } = createEventCollector();
    const runner = new DeckRunner(getWindow, new ActivityLog(activityDir));
    const started = await runner.start(deckPath, {
      slideIds: [entry.slideId],
    });

    expect(started.accepted).toBe(false);
    expect(started.queued).toBe(0);
    expect(started.message).toContain("已全部完成");
    expect(runner.isRunning()).toBe(false);
  });

  it("对不存在的 deck 拒绝启动", async () => {
    const { activityDir } = await createFixtureDeck();
    const { getWindow } = createEventCollector();
    const runner = new DeckRunner(getWindow, new ActivityLog(activityDir));

    await expect(
      runner.start(join(tmpdir(), "deck-runner-missing"), {}),
    ).rejects.toThrow();
    expect(runner.isRunning()).toBe(false);
  });
});
