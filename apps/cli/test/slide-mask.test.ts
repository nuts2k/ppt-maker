import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TextReviewDocument } from "@ppt-maker/core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { runSlideMask } from "../src/mask/run.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import { runSlideReview } from "../src/slide/review.js";
import { runSlideValidateReview } from "../src/slide/validate-review.js";
import {
  assertWorkspaceAssetIntegrity,
  createSlideWorkspace,
  loadSlideWorkspace,
} from "../src/slide/workspace.js";

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/single-slide/complex-page.png", import.meta.url),
  );
}

// fake OCR：以合成 fixture 已知的字形坐标发块，避免在测试里依赖真实 Vision 二进制。
// 顺序（阅读序）：标题（白，同色结构）→ 核心指标（白，容器内）→ 限时优惠（金，旋转艺术字）。
async function createFakeVisionBinary(directory: string): Promise<string> {
  const path = join(directory, "fake-vision");
  const response = {
    schemaVersion: 1,
    provider: "apple-vision",
    image: { width: 1600, height: 900 },
    blocks: [
      {
        id: "title",
        text: "全球营收概览",
        bboxPx: { x: 95, y: 44, width: 307, height: 54 },
        confidence: 0.95,
        rotationDeg: null,
        glyphHints: [],
      },
      {
        id: "card",
        text: "核心指标",
        bboxPx: { x: 128, y: 276, width: 128, height: 36 },
        confidence: 0.95,
        rotationDeg: null,
        glyphHints: [],
      },
      {
        id: "art",
        text: "限时优惠",
        bboxPx: { x: 1061, y: 611, width: 231, height: 153 },
        confidence: 0.9,
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

const FOREGROUND = ["#ffffff", "#ffffff", "#fad16b"];

async function editReviewBlocks(
  reviewPath: string,
  options: { reviewStatus: "reviewed" | "unreviewed" },
): Promise<void> {
  const document = JSON.parse(
    await readFile(reviewPath, "utf8"),
  ) as TextReviewDocument;
  document.blocks.forEach((block, index) => {
    const color = FOREGROUND[index];
    if (color === undefined) {
      return;
    }
    block.includeInMask = true;
    block.classification = "layout_text";
    block.reviewStatus = options.reviewStatus;
    block.updatedAt = "2026-07-20T05:00:00.000Z";
    block.maskParams.foregroundColors = [color];
    block.maskParams.colorTolerance = 96;
  });
  await writeFile(reviewPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function prepareReviewed(options: {
  reviewStatus: "reviewed" | "unreviewed";
}): Promise<{ workspacePath: string; reviewPath: string }> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-mask-"));
  const workspacePath = join(parent, "slide");
  const binaryPath = await createFakeVisionBinary(parent);
  await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
  await runSlideOcr({ workspacePath, binaryPath });
  const review = await runSlideReview({ workspacePath });
  await editReviewBlocks(review.outputPath, options);
  return { workspacePath, reviewPath: review.outputPath };
}

describe("slide mask", () => {
  it("从已复核块派生 mask 并建立覆盖率基线，容器填充不破坏", async () => {
    const { workspacePath } = await prepareReviewed({
      reviewStatus: "reviewed",
    });
    await runSlideValidateReview({ workspacePath });
    const result = await runSlideMask({ workspacePath });

    expect(result.reused).toBe(false);
    const record = JSON.parse(
      await readFile(join(workspacePath, "stages/mask/record.json"), "utf8"),
    );
    // 覆盖率数值基线（读取已入库的 complex-page.png，确定性可复现）。
    expect(record.totals.maskedPixels).toBe(21944);
    expect(record.totals.maskedBlockCount).toBe(3);
    const byId = Object.fromEntries(
      record.blocks.map((block: { blockId: string }) => [block.blockId, block]),
    );
    expect(byId["block-001"].maskedPixels).toBe(11196); // 标题（同色结构）
    expect(byId["block-002"].maskedPixels).toBe(2708); // 容器内文字
    expect(byId["block-003"].maskedPixels).toBe(8040); // 旋转艺术字
    expect(byId["block-002"].coverageRatio).toBeGreaterThan(0.4);

    // mask 为同源尺寸带 alpha 的 PNG；字形透明(alpha=0)，容器填充不透明。
    const decoded = await sharp(join(workspacePath, "stages/mask/mask.png"))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([decoded.info.width, decoded.info.height]).toEqual([1600, 900]);
    expect(decoded.info.channels).toBe(4);
    const alphaAt = (x: number, y: number) =>
      decoded.data[(y * decoded.info.width + x) * decoded.info.channels + 3];
    // 卡片填充内非文字点未被掩盖。
    expect(alphaAt(450, 500)).toBe(255);

    const second = await runSlideMask({ workspacePath });
    expect(second.reused).toBe(true);
  });

  it("未通过 validate-review 时拒绝运行 mask", async () => {
    const { workspacePath } = await prepareReviewed({
      reviewStatus: "reviewed",
    });
    await expect(runSlideMask({ workspacePath })).rejects.toThrow(
      "validate-review",
    );
  });

  it("参与 mask 的块未复核时拒绝运行", async () => {
    const { workspacePath } = await prepareReviewed({
      reviewStatus: "unreviewed",
    });
    await runSlideValidateReview({ workspacePath });
    await expect(runSlideMask({ workspacePath })).rejects.toThrow("未复核");
  });

  it("校验后改动复核文件会阻止 mask", async () => {
    const { workspacePath, reviewPath } = await prepareReviewed({
      reviewStatus: "reviewed",
    });
    await runSlideValidateReview({ workspacePath });
    await runSlideMask({ workspacePath });

    const document = JSON.parse(
      await readFile(reviewPath, "utf8"),
    ) as TextReviewDocument;
    const first = document.blocks[0];
    if (first !== undefined) {
      first.maskParams.colorTolerance = 64;
    }
    await writeFile(
      reviewPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );

    await expect(runSlideMask({ workspacePath })).rejects.toThrow(
      "重新运行 validate-review",
    );
  });

  it("人工篡改 mask.png 会被完整性校验拒绝", async () => {
    const { workspacePath } = await prepareReviewed({
      reviewStatus: "reviewed",
    });
    await runSlideValidateReview({ workspacePath });
    await runSlideMask({ workspacePath });

    await writeFile(
      join(workspacePath, "stages/mask/mask.png"),
      "tampered-bytes",
      "utf8",
    );
    const loaded = await loadSlideWorkspace(workspacePath);
    const maskAsset = loaded.manifest.assets.find(
      (asset) => asset.role === "mask",
    );
    if (maskAsset === undefined) {
      throw new Error("缺少 mask 资产");
    }
    await expect(
      assertWorkspaceAssetIntegrity(workspacePath, maskAsset),
    ).rejects.toThrow("完整性");
  });
});
