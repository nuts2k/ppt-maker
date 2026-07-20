import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TextReviewDocument } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { runSlideOcr } from "../src/slide/ocr.js";
import { runSlideReview } from "../src/slide/review.js";
import { runSlideValidateReview } from "../src/slide/validate-review.js";
import { createSlideWorkspace } from "../src/slide/workspace.js";

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

async function createFakeVisionBinary(directory: string): Promise<string> {
  const path = join(directory, "fake-vision");
  const response = {
    schemaVersion: 1,
    provider: "apple-vision",
    image: { width: 1600, height: 900 },
    blocks: [
      {
        id: "block-1",
        text: "你好世界",
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

async function prepareWorkspace(): Promise<{
  workspacePath: string;
  reviewPath: string;
}> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-validate-review-"));
  const workspacePath = join(parent, "slide");
  const binaryPath = await createFakeVisionBinary(parent);
  await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
  await runSlideOcr({ workspacePath, binaryPath });
  const review = await runSlideReview({ workspacePath });
  return { workspacePath, reviewPath: review.outputPath };
}

describe("slide validate-review", () => {
  it("合法复核文档通过并锚定文档哈希", async () => {
    const { workspacePath, reviewPath } = await prepareWorkspace();
    const { report } = await runSlideValidateReview({ workspacePath });

    expect(report.status).toBe("passed");
    expect(report.summary.errors).toBe(0);
    const bytes = await readFile(reviewPath, "utf8");
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(report.documentSha256).toBe(expected);
  });

  it("人工编辑引入违规时校验失败", async () => {
    const { workspacePath, reviewPath } = await prepareWorkspace();
    const document = JSON.parse(
      await readFile(reviewPath, "utf8"),
    ) as TextReviewDocument;
    const target = document.blocks[0];
    if (target === undefined) {
      throw new Error("缺少可编辑的复核块");
    }
    // 不确定项被人工错误地标记为参与 mask。
    target.classification = "uncertain";
    target.includeInMask = true;
    await writeFile(
      reviewPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );

    const { report } = await runSlideValidateReview({ workspacePath });
    expect(report.status).toBe("failed");
    expect(report.violations.map((violation) => violation.code)).toContain(
      "MASK_REQUIRES_LAYOUT_TEXT",
    );
  });

  it("Schema 非法的复核文件报告 SCHEMA_INVALID 且失败", async () => {
    const { workspacePath, reviewPath } = await prepareWorkspace();
    const document = JSON.parse(await readFile(reviewPath, "utf8"));
    document.blocks[0].classification = "not-a-class";
    await writeFile(
      reviewPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );

    const { report } = await runSlideValidateReview({ workspacePath });
    expect(report.status).toBe("failed");
    expect(report.violations.map((violation) => violation.code)).toContain(
      "SCHEMA_INVALID",
    );
  });

  it("未完成 review 时拒绝运行", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-validate-review-"));
    const workspacePath = join(parent, "slide");
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });

    await expect(runSlideValidateReview({ workspacePath })).rejects.toThrow(
      "必须先完成 review",
    );
  });
});
