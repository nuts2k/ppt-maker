import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ContentSpec, SCHEMA_VERSION } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { writeDeckContentSpec } from "../src/deck/content-spec.js";
import { formatDeckRunResult, runDeckPipeline } from "../src/deck/run.js";
import { deckStatus, formatDeckStatus } from "../src/deck/status.js";
import { createEmptyDeckWorkspace } from "../src/deck/workspace.js";

/**
 * T7（父任务子任务①）：零页 deck 边界（prd.md S6）。
 *
 * Phase 1 调研结论是 `deck run` / `deck status` 在零页 deck 上已经结构性安全——
 * 全是 for...of 空循环 + 长度判断，无下标直取、无除法。这份用例只做验证与回归锁定，
 * 不预设一定要改生产代码。
 */
async function createEmptyDeck(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-zero-page-"));
  const deckPath = join(parent, "deck");
  await createEmptyDeckWorkspace({ workspacePath: deckPath });
  return deckPath;
}

function sampleSpec(): ContentSpec {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    specId: "spec-zero-page-test",
    createdAt: now,
    updatedAt: now,
    style: { description: "极简、蓝白配色、无衬线字体" },
    entries: [
      {
        specEntryId: "entry-001",
        pageType: "cover",
        textGroups: [{ label: "标题", items: ["测试封面"] }],
        visualIntent: "居中大标题",
        revisionNotes: [],
      },
      {
        specEntryId: "entry-002",
        pageType: "content",
        textGroups: [{ label: "要点", items: ["要点一", "要点二"] }],
        visualIntent: "左文右图",
        revisionNotes: [],
      },
    ],
  };
}

describe("零页 deck：deck status", () => {
  it("有规格但一页没生成时不抛，汇总数字全 0，规格对账不崩", async () => {
    const deckPath = await createEmptyDeck();
    await writeDeckContentSpec(deckPath, sampleSpec());

    const result = await deckStatus(deckPath);

    expect(result.slides).toEqual([]);
    expect(result.summary).toEqual({
      total: 0,
      active: 0,
      removed: 0,
      completed: 0,
      inProgress: 0,
      notStarted: 0,
    });
  });

  it("formatDeckStatus 输出「完成: 0/0」，不含 NaN 与 undefined", async () => {
    const deckPath = await createEmptyDeck();
    await writeDeckContentSpec(deckPath, sampleSpec());

    const text = formatDeckStatus(await deckStatus(deckPath));

    expect(text).toContain("完成: 0/0");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });

  it("--verbose 同样不抛且不含 NaN / undefined", async () => {
    const deckPath = await createEmptyDeck();
    await writeDeckContentSpec(deckPath, sampleSpec());

    const text = formatDeckStatus(await deckStatus(deckPath), {
      verbose: true,
    });

    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });

  it("零页 + 没有 content-spec.json 时同样不抛", async () => {
    const deckPath = await createEmptyDeck();

    const result = await deckStatus(deckPath);
    const text = formatDeckStatus(result);

    expect(result.summary.total).toBe(0);
    expect(text).toContain("完成: 0/0");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });
});

describe("零页 deck：deck run", () => {
  it("有规格但一页没生成时不抛，summary 全 0", async () => {
    const deckPath = await createEmptyDeck();
    await writeDeckContentSpec(deckPath, sampleSpec());

    const result = await runDeckPipeline({ deckPath });

    expect(result.results).toEqual([]);
    expect(result.summary).toEqual({
      total: 0,
      completed: 0,
      stopped: 0,
      failed: 0,
    });
  });

  it("formatDeckRunResult 输出汇总行，不含 NaN 与 undefined", async () => {
    const deckPath = await createEmptyDeck();
    await writeDeckContentSpec(deckPath, sampleSpec());

    const text = formatDeckRunResult(await runDeckPipeline({ deckPath }));

    expect(text).toContain("汇总：0 页，完成 0，停止 0，失败 0");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });

  it("零页 + 没有 content-spec.json 时同样不抛", async () => {
    const deckPath = await createEmptyDeck();

    const result = await runDeckPipeline({ deckPath });
    const text = formatDeckRunResult(result);

    expect(result.summary.total).toBe(0);
    expect(text).toContain("汇总：0 页，完成 0，停止 0，失败 0");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });
});
