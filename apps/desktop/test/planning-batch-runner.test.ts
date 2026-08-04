import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runDeckGenerate } from "@cli/deck/generate.js";
import type { OpenAiImageGenerator } from "@cli/providers/openai-image.js";
import { describe, expect, it } from "vitest";
import {
  buildSpec,
  fakeGenerator,
  fakePageImage,
  writeSpecFile,
} from "../../cli/test/deck-generate-fixtures.js";
import { ActivityLog } from "../src/main/activity-log.js";
import { SourceTaskRunner } from "../src/main/runner/source-task-runner.js";

async function hashTree(root: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    tree[relative(root, absolute)] = createHash("sha256")
      .update(await readFile(absolute))
      .digest("hex");
  }
  return tree;
}

async function setup(
  generate: OpenAiImageGenerator,
): Promise<{ deckPath: string; runner: SourceTaskRunner }> {
  const parent = await mkdtemp(join(tmpdir(), "planning-batch-runner-"));
  const deckPath = join(parent, "deck");
  const specPath = await writeSpecFile(parent, buildSpec());
  await runDeckGenerate({
    deckPath,
    specPath,
    confirmUpload: true,
    generate: fakeGenerator(await fakePageImage(), "req_initial"),
  });

  return {
    deckPath,
    runner: new SourceTaskRunner(
      () => null,
      new ActivityLog(join(parent, "activity")),
      () => false,
      { regenerateBatchGenerate: generate },
    ),
  };
}

describe("SourceTaskRunner 批量重生成", () => {
  it("只执行用户勾选的标签，未勾选页目录逐字节不变", async () => {
    const buffer = await fakePageImage();
    const { deckPath, runner } = await setup(
      fakeGenerator(buffer, "req_batch_selected"),
    );
    const selectedPath = join(deckPath, "slides/page-01");
    const untouchedPath = join(deckPath, "slides/page-02");
    const selectedBefore = await hashTree(selectedPath);
    const untouchedBefore = await hashTree(untouchedPath);

    const result = await runner.start(deckPath, {
      kind: "regenerate-batch",
      pageLabels: ["page-01"],
    });

    expect(result.accepted).toBe(true);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(await hashTree(selectedPath)).not.toEqual(selectedBefore);
    expect(await hashTree(untouchedPath)).toEqual(untouchedBefore);
  }, 180_000);

  it("单页失败不终止其余勾选页", async () => {
    const buffer = await fakePageImage();
    const succeed = fakeGenerator(buffer, "req_batch_partial");
    const flaky: OpenAiImageGenerator = async (params) => {
      if (String(params.prompt).includes("全球营收概览")) {
        throw new Error("网关 500");
      }
      return succeed(params);
    };
    const { deckPath, runner } = await setup(flaky);
    const secondBefore = await hashTree(join(deckPath, "slides/page-02"));

    const result = await runner.start(deckPath, {
      kind: "regenerate-batch",
      pageLabels: ["page-01", "page-02"],
    });

    expect(result.accepted).toBe(true);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.message).toContain("重新生成 1 页，失败 1 页");
    expect(await hashTree(join(deckPath, "slides/page-02"))).not.toEqual(
      secondBefore,
    );
  }, 180_000);
});
