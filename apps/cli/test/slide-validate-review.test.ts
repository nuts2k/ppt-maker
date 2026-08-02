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

describe("validate-review 的复用与规则版本差", () => {
  const VALIDATION_PATH = "stages/review/validation.json";

  /*
   * 缺陷回归（2026-08-02 阶段三走查）：`deck run` 每跑一次就重写一遍 validation.json，
   * 只有 checkedAt 变，于是「已完成页零变化」这条不变量被打穿。
   *
   * validate-review 是瞬态阶段（不写 `stages`），没有 `isStageReusable` 可用，但
   * 判据本来就在产物里：同一份复核稿 + 同一版规则 = 同一份结论。
   * **不为它造一个假的持久阶段状态。**
   */
  it("复核稿与规则都没变时复用既有结论，文件逐字节不变", async () => {
    const { workspacePath } = await prepareWorkspace();
    await runSlideValidateReview({ workspacePath });
    const path = join(workspacePath, VALIDATION_PATH);
    const before = await readFile(path, "utf8");

    const { report, previousRulesVersion } = await runSlideValidateReview({
      workspacePath,
    });

    expect(await readFile(path, "utf8")).toBe(before);
    expect(previousRulesVersion).toBeNull();
    expect(report.status).toBe("passed");
  });

  it("复核稿改动后重新校验，不再复用", async () => {
    const { workspacePath, reviewPath } = await prepareWorkspace();
    await runSlideValidateReview({ workspacePath });
    const path = join(workspacePath, VALIDATION_PATH);
    const before = JSON.parse(await readFile(path, "utf8")) as {
      documentSha256: string;
    };

    const document = JSON.parse(
      await readFile(reviewPath, "utf8"),
    ) as TextReviewDocument;
    const block = document.blocks[0];
    if (block !== undefined) {
      block.text = "你好世界 2026";
      block.lines = ["你好世界 2026"];
    }
    await writeFile(
      reviewPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );

    const { report } = await runSlideValidateReview({ workspacePath });
    expect(report.documentSha256).not.toBe(before.documentSha256);
  });

  /*
   * 观察项收口：2026-07-25 之前建的 deck 会因 `review-validation-v1 → v2`
   * 新增的规则在 `deck run` 时停住。失败本身是响亮的，但读起来像「你把文件改坏了」，
   * 而这份文档产出时那条规则还不存在。
   */
  it("上一份报告的规则版本不同时如实回报，供失败提示点明", async () => {
    const { workspacePath } = await prepareWorkspace();
    await runSlideValidateReview({ workspacePath });
    const path = join(workspacePath, VALIDATION_PATH);
    const stored = JSON.parse(await readFile(path, "utf8")) as {
      rulesVersion: string;
    };
    const currentVersion = stored.rulesVersion;
    stored.rulesVersion = "review-validation-v0";
    await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`, "utf8");

    const { report, previousRulesVersion } = await runSlideValidateReview({
      workspacePath,
    });
    // 规则版本变了就必须重算，不能拿旧版规则的结论顶数
    expect(previousRulesVersion).toBe("review-validation-v0");
    expect(report.rulesVersion).toBe(currentVersion);
  });
});
