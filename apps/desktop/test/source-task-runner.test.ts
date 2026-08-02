/**
 * 建页任务失败时的可发现性锁（父任务 A5「探测结果在界面可见」）。
 *
 * 缺陷回归（2026-08-02 阶段三走查）：往一个已存在的 deck 里抽一份全非 16:9 的 PDF，
 * 报告照常写进 `<deck>/extractions/`，逐页写着尺寸与被跳过的原因；而活动日志那条
 * 失败记录**不带 `reportPath`**，`ActivityPanel` 的「查看报告」按钮条件
 * （`reportPath !== undefined`）不成立——磁盘上那份报告在界面里完全不可达。
 *
 * 用真实 PDF 夹具驱动真实执行器：`SourceTaskRunner` 只把 BrowserWindow 当事件出口，
 * 运行时不依赖 Electron。桩掉抽取会把被测的那一环（错误详情怎么传出来）一起桩掉。
 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeckWorkspace } from "@cli/deck/workspace.js";
import type { BrowserWindow } from "electron";
import { describe, expect, it } from "vitest";
import { ActivityLog } from "../src/main/activity-log.js";
import { resolveDeckId } from "../src/main/deck-context.js";
import { SourceTaskRunner } from "../src/main/runner/source-task-runner.js";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function pdfFixture(name: string): string {
  return join(projectRoot, "fixtures", "pdf-extraction", name);
}

/** 只做事件出口，不断言事件内容——本用例关心的是落进日志的那一条 */
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
  activityLog: ActivityLog;
}> {
  const base = await mkdtemp(join(tmpdir(), "source-task-runner-"));
  const deck = await createDeckWorkspace({
    imagesDir: join(projectRoot, "fixtures", "single-slide"),
    workspacePath: join(base, "deck"),
    name: "source-task-fixture",
  });
  const activityLog = new ActivityLog(join(base, "activity"));
  const runner = new SourceTaskRunner(silentWindow(), activityLog, () => false);
  return { deckPath: deck.path, runner, activityLog };
}

describe("抽取成功时的活动日志", () => {
  /*
   * 已有能力的回归锁：完成面板关掉之后，回溯入口只剩活动日志这一条
   * （`ActivityPanel` 的按钮条件是 `reportPath !== undefined`）。
   * 这条记录一旦不带路径，那份报告在界面里就再也点不开。
   */
  it("成功记录带上报告路径，供关闭完成面板后回溯", async () => {
    const { deckPath, runner, activityLog } = await setup();

    const result = await runner.start(deckPath, {
      kind: "extract",
      pdfPath: pdfFixture("mixed-aspect.pdf"),
    });
    expect(result.accepted).toBe(true);

    const records = await activityLog.list(await resolveDeckId(deckPath));
    const success = records.find((record) => record.kind === "deck-extract");
    expect(success?.result).toBe("success");
    expect(success?.reportPath).toBe(result.reportPath);
  });
});

describe("抽取失败时的活动日志", () => {
  it("零建立时带上报告路径，且路径指向磁盘上真实存在的报告", async () => {
    const { deckPath, runner, activityLog } = await setup();

    await expect(
      runner.start(deckPath, {
        kind: "extract",
        pdfPath: pdfFixture("no-wide.pdf"),
      }),
    ).rejects.toThrow("没有可用于建立页面的 16:9 页");

    const records = await activityLog.list(await resolveDeckId(deckPath));
    const failure = records.find((record) => record.result === "failure");
    expect(failure?.kind).toBe("deck-extract");
    expect(failure?.reportPath).toBeDefined();

    // 「有这个字段」还不够：它必须真的能读回一份逐页写着原因的报告
    const report = JSON.parse(
      await readFile(failure?.reportPath ?? "", "utf8"),
    ) as { created: unknown[]; skipped: { reason: { message: string } }[] };
    expect(report.created).toHaveLength(0);
    expect(report.skipped.length).toBeGreaterThan(0);
    expect(report.skipped[0]?.reason.message.length).toBeGreaterThan(0);
  });

  it("与抽取无关的失败不凭空造一个报告入口", async () => {
    const { deckPath, runner, activityLog } = await setup();

    await expect(
      runner.start(deckPath, {
        kind: "extract",
        pdfPath: join(projectRoot, "fixtures", "pdf-extraction", "missing.pdf"),
      }),
    ).rejects.toThrow();

    const records = await activityLog.list(await resolveDeckId(deckPath));
    const failure = records.find((record) => record.result === "failure");
    expect(failure).toBeDefined();
    expect(failure?.reportPath).toBeUndefined();
  });
});
