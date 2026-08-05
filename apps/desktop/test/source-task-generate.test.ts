/**
 * 建页任务 generate 分支的透传锁（T3）。
 *
 * 两件事必须成立，且都是**看不见的**那种——错了不会报错，只会悄悄跑成另一条路：
 *
 * 1. 不传 `specPath` 时，落到 `runDeckGenerate` 的入参里**不能有** `specPath`。
 *    传一个 `undefined` 以外的伪值（空串、deck 内规格的拼接路径）会让 CLI 去读一个
 *    外部文件，而不是走「读 deck 内权威规格」那条路。
 * 2. `entryIds` 原样透传。勾选集合即执行集合，桌面端在这里做任何筛选都会与付费
 *    确认框上的数字对不上。
 *
 * 桩掉 `runDeckGenerate` 而不是真跑：这条用例问的是「执行器把什么交给了 CLI」，
 * 真跑会发起付费的图像生成。
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeckGenerateOptions } from "@cli/deck/generate.js";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityLog } from "../src/main/activity-log.js";
import { SourceTaskRunner } from "../src/main/runner/source-task-runner.js";

const captured = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock("@cli/deck/generate.js", () => ({
  runDeckGenerate: vi.fn(async (options: DeckGenerateOptions) => {
    captured.calls.push({ ...options });
    return {
      deckPath: options.deckPath,
      created: [],
      failed: [],
      skipped: [],
      reconciliation: { newEntries: [], missingPages: [], drifted: [] },
    };
  }),
}));

function silentWindow(): () => BrowserWindow | null {
  const fake = {
    isDestroyed: () => false,
    webContents: { send: () => undefined },
  } as unknown as BrowserWindow;
  return () => fake;
}

async function setup(): Promise<{
  deckPath: string;
  runner: SourceTaskRunner;
}> {
  const base = await mkdtemp(join(tmpdir(), "source-task-generate-"));
  const runner = new SourceTaskRunner(
    silentWindow(),
    new ActivityLog(join(base, "activity")),
    () => false,
  );
  return { deckPath: join(base, "deck"), runner };
}

beforeEach(() => {
  captured.calls.length = 0;
});

describe("建页任务的 generate 分支", () => {
  it("省略 specPath 时入参里没有这个键，让 CLI 读 deck 内规格", async () => {
    const { deckPath, runner } = await setup();

    const result = await runner.start(deckPath, {
      kind: "generate",
      entryIds: ["entry-002", "entry-005"],
    });

    expect(result.accepted).toBe(true);
    const options = captured.calls[0];
    expect(options).toBeDefined();
    expect(options && "specPath" in options).toBe(false);
    expect(options?.entryIds).toEqual(["entry-002", "entry-005"]);
    expect(options?.deckPath).toBe(deckPath);
    expect(options?.confirmUpload).toBe(true);
  });

  it("SourcePicker 那两条路照旧传 specPath，且不带条目子集", async () => {
    const { deckPath, runner } = await setup();

    await runner.start(deckPath, {
      kind: "generate",
      specPath: "/tmp/external-spec.json",
      deckName: "外部规格 deck",
    });

    const options = captured.calls[0];
    expect(options?.specPath).toBe("/tmp/external-spec.json");
    expect(options?.name).toBe("外部规格 deck");
    expect(options && "entryIds" in options).toBe(false);
  });

  it("勾选一条时只透传一条，不被扩成全量", async () => {
    const { deckPath, runner } = await setup();

    await runner.start(deckPath, { kind: "generate", entryIds: ["entry-003"] });

    expect(captured.calls[0]?.entryIds).toEqual(["entry-003"]);
  });
});
