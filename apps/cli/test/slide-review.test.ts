import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TextReviewDocument } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { runSlideOcr } from "../src/slide/ocr.js";
import { runSlideReview } from "../src/slide/review.js";
import { createSlideWorkspace } from "../src/slide/workspace.js";

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

async function createFakeVisionBinary(
  directory: string,
  fileName: string,
  text: string,
): Promise<string> {
  const path = join(directory, fileName);
  const response = {
    schemaVersion: 1,
    provider: "apple-vision",
    image: { width: 1600, height: 900 },
    blocks: [
      {
        id: "block-1",
        text,
        bboxPx: { x: 120, y: 100, width: 480, height: 80 },
        confidence: 0.95,
        rotationDeg: null,
        glyphHints: [],
      },
    ],
  };
  await writeFile(
    path,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(
      JSON.stringify(response),
    )});\n`,
    "utf8",
  );
  await chmod(path, 0o755);
  return path;
}

async function readReview(outputPath: string): Promise<TextReviewDocument> {
  return JSON.parse(await readFile(outputPath, "utf8")) as TextReviewDocument;
}

describe("slide review", () => {
  it("合并 OCR 候选生成 text-blocks.json 并在输入未变化时复用", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-review-"));
    const workspacePath = join(parent, "slide");
    const binaryPath = await createFakeVisionBinary(
      parent,
      "fake-vision",
      "你好世界",
    );
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
    await runSlideOcr({ workspacePath, binaryPath });

    const first = await runSlideReview({ workspacePath });
    const document = await readReview(first.outputPath);
    expect(first.reused).toBe(false);
    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0]?.text).toBe("你好世界");
    expect(document.blocks[0]?.classification).toBe("uncertain");
    expect(document.blocks[0]?.sources[0]?.kind).toBe("offline_ocr");

    const second = await runSlideReview({ workspacePath });
    expect(second).toMatchObject({ reused: true, attemptId: first.attemptId });
  });

  it("上游 OCR 变化后重跑保留人工确认值并刷新候选", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-review-"));
    const workspacePath = join(parent, "slide");
    const binaryA = await createFakeVisionBinary(
      parent,
      "fake-vision-a",
      "初始候选",
    );
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
    await runSlideOcr({ workspacePath, binaryPath: binaryA });
    const first = await runSlideReview({ workspacePath });

    // 模拟人工在唯一编辑入口订正文字并标记已复核。
    const edited = await readReview(first.outputPath);
    const block = edited.blocks[0];
    if (block === undefined) {
      throw new Error("缺少待编辑的复核块");
    }
    block.text = "人工订正";
    block.reviewStatus = "reviewed";
    block.updatedAt = "2026-07-20T03:00:00.000Z";
    block.sources.push({
      kind: "manual",
      provider: "manual",
      text: "人工订正",
      confidence: null,
    });
    await writeFile(
      first.outputPath,
      `${JSON.stringify(edited, null, 2)}\n`,
      "utf8",
    );

    // 上游 OCR 文本变化：换用产出不同文本的二进制并重跑 ocr。
    const binaryB = await createFakeVisionBinary(
      parent,
      "fake-vision-b",
      "刷新候选",
    );
    await runSlideOcr({ workspacePath, binaryPath: binaryB });

    const rerun = await runSlideReview({ workspacePath });
    expect(rerun.reused).toBe(false);
    const merged = await readReview(rerun.outputPath);
    const preserved = merged.blocks[0];
    expect(preserved?.text).toBe("人工订正");
    expect(preserved?.reviewStatus).toBe("reviewed");
    const offline = preserved?.sources.find(
      (source) => source.kind === "offline_ocr",
    );
    expect(offline?.text).toBe("刷新候选");
    expect(preserved?.sources.some((source) => source.kind === "manual")).toBe(
      true,
    );
  });

  it("未完成 OCR 时拒绝运行 review", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-review-"));
    const workspacePath = join(parent, "slide");
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });

    await expect(runSlideReview({ workspacePath })).rejects.toThrow(
      "必须先完成 ocr",
    );
  });
});
