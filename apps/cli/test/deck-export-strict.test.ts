import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DoctorReport, TextReviewDocumentSchema } from "@ppt-maker/core";
import type OpenAI from "openai";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { runSlideClean } from "../src/clean/run.js";
import { exportDeckPptx } from "../src/deck/export.js";
import { createDeckWorkspace, resolveDeckPath } from "../src/deck/workspace.js";
import { runSlideMask } from "../src/mask/run.js";
import { runAcceptPptx } from "../src/pptx/accept.js";
import { runSlidePptx } from "../src/pptx/run.js";
import type { OpenAiImageEditor } from "../src/providers/openai-image.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import { runSlideReview } from "../src/slide/review.js";
import { runSlideValidateReview } from "../src/slide/validate-review.js";
import {
  loadSlideWorkspace,
  writeWorkspaceManifest,
} from "../src/slide/workspace.js";

// B3 放宽了 pptx 对「clean 已人工验收」的前置要求，批准的前提条件是
// deck export --strict 的导出语义不被削弱：仍必须每页 accept-pptx completed。
// 这一条只能实测，不能假定（implement.md 风险文件表）。

const FONT = "Microsoft YaHei";

function fontReadyReport(): DoctorReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-20T00:00:00.000Z",
    checks: [
      {
        id: "font-microsoft-yahei",
        label: FONT,
        status: "pass",
        message: "test font available",
      },
    ],
    summary: { pass: 1, warn: 0, fail: 0 },
  };
}

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/single-slide/complex-page.png", import.meta.url),
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
        id: "title",
        text: "全球营收概览",
        bboxPx: { x: 95, y: 44, width: 307, height: 54 },
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

async function buildFakeCleanPlate(
  sourcePath: string,
  maskPath: string,
): Promise<Buffer> {
  const src = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = await sharp(maskPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.from(src.data);
  for (let i = 0; i < src.info.width * src.info.height; i += 1) {
    if ((mask.data[i * 4 + 3] ?? 255) === 0) {
      out[i * 4] = 15;
      out[i * 4 + 1] = 26;
      out[i * 4 + 2] = 46;
    }
  }
  return sharp(out, {
    raw: { width: src.info.width, height: src.info.height, channels: 4 },
  })
    .resize(2048, 1152, { fit: "fill" })
    .png()
    .toBuffer();
}

function fakeEditor(cleanBuffer: Buffer): OpenAiImageEditor {
  return async () => ({
    response: {
      created: 0,
      data: [{ b64_json: cleanBuffer.toString("base64") }],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { image_tokens: 1, text_tokens: 0 },
      },
    } as OpenAI.Images.ImagesResponse,
    requestId: "req_fake",
  });
}

async function markAssistReviewCompleted(workspacePath: string): Promise<void> {
  const workspace = await loadSlideWorkspace(workspacePath);
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    stages: workspace.manifest.stages.map((state) =>
      state.stage === "assist-review"
        ? {
            ...state,
            status: "completed" as const,
            lastSuccessfulAttemptId: "assist-review-skip",
            completedInputFingerprint:
              "0000000000000000000000000000000000000000000000000000000000000000",
          }
        : state,
    ),
  });
}

// 建一个单页 deck，跑到 pptx 完成但两个验收都不做。
async function setupDeckThroughPptx(): Promise<{
  deckPath: string;
  slideWorkspacePath: string;
  outputPath: string;
}> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-strict-"));
  const imagesDir = join(parent, "images");
  await mkdir(imagesDir, { recursive: true });
  await copyFile(fixturePath(), join(imagesDir, "page-01.png"));

  const deckPath = join(parent, "deck");
  await createDeckWorkspace({ imagesDir, workspacePath: deckPath });
  const slideWorkspacePath = resolveDeckPath(deckPath, "slides/page-01");

  const binaryPath = await createFakeVisionBinary(parent);
  await runSlideOcr({ workspacePath: slideWorkspacePath, binaryPath });
  const review = await runSlideReview({ workspacePath: slideWorkspacePath });
  await markAssistReviewCompleted(slideWorkspacePath);

  const doc = TextReviewDocumentSchema.parse(
    JSON.parse(await readFile(review.outputPath, "utf8")),
  );
  const title = doc.blocks[0];
  if (title !== undefined) {
    title.includeInMask = true;
    title.classification = "layout_text";
    title.reviewStatus = "reviewed";
    title.updatedAt = "2026-07-20T05:00:00.000Z";
    title.maskParams.foregroundColors = ["#ffffff"];
    title.maskParams.colorTolerance = 96;
  }
  await writeFile(
    review.outputPath,
    `${JSON.stringify(doc, null, 2)}\n`,
    "utf8",
  );

  await runSlideValidateReview({ workspacePath: slideWorkspacePath });
  await runSlideMask({ workspacePath: slideWorkspacePath });
  const cleanBuffer = await buildFakeCleanPlate(
    join(slideWorkspacePath, "inputs/source.png"),
    join(slideWorkspacePath, "stages/mask/mask.png"),
  );
  await runSlideClean({
    workspacePath: slideWorkspacePath,
    confirmUpload: true,
    edit: fakeEditor(cleanBuffer),
  });
  await runSlidePptx({
    workspacePath: slideWorkspacePath,
    fontFace: FONT,
    doctorReport: fontReadyReport(),
  });

  return {
    deckPath,
    slideWorkspacePath,
    outputPath: join(parent, "deck.pptx"),
  };
}

describe("deck export --strict", () => {
  it("accept-pptx 未完成时仍拒绝导出", async () => {
    const { deckPath, outputPath } = await setupDeckThroughPptx();
    await expect(
      exportDeckPptx({ deckPath, outputPath, strict: true, fontFace: FONT }),
    ).rejects.toThrow("accept-pptx");
  });

  it("accept-pptx 完成后放行", async () => {
    const { deckPath, slideWorkspacePath, outputPath } =
      await setupDeckThroughPptx();
    await runAcceptPptx({
      workspacePath: slideWorkspacePath,
      acceptedBy: "dev",
    });
    const result = await exportDeckPptx({
      deckPath,
      outputPath,
      strict: true,
      fontFace: FONT,
    });
    expect(result.nativeSlides).toBe(1);
    expect(result.placeholderSlides).toBe(0);
  });
});
