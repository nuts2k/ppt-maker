import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DoctorReport, TextReviewDocument } from "@ppt-maker/core";
import type OpenAI from "openai";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { runAcceptClean } from "../src/clean/accept.js";
import { runSlideClean } from "../src/clean/run.js";
import { runSlideMask } from "../src/mask/run.js";
import { runAcceptPptx } from "../src/pptx/accept.js";
import { runSlidePptx } from "../src/pptx/run.js";
import type { OpenAiImageEditor } from "../src/providers/openai-image.js";
import { runSlideReport } from "../src/report/run.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import { runSlideReview } from "../src/slide/review.js";
import { runSlideValidateReview } from "../src/slide/validate-review.js";
import {
  createSlideWorkspace,
  loadSlideWorkspace,
  writeWorkspaceManifest,
} from "../src/slide/workspace.js";

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

// 覆盖五类元素：中文标题、中英混排副标题、容器内文字、对象内符号、旋转艺术字。
const BLOCKS = [
  {
    id: "title",
    text: "全球营收概览",
    bboxPx: { x: 95, y: 44, width: 307, height: 54 },
  },
  {
    id: "subtitle",
    text: "Global Revenue Overview · 2026 财年 Q2",
    bboxPx: { x: 93, y: 120, width: 527, height: 33 },
  },
  {
    id: "card",
    text: "核心指标",
    bboxPx: { x: 128, y: 276, width: 128, height: 36 },
  },
  {
    id: "symbol",
    text: "85%",
    bboxPx: { x: 709, y: 358, width: 105, height: 65 },
  },
  {
    id: "art",
    text: "限时优惠",
    bboxPx: { x: 1061, y: 611, width: 231, height: 153 },
  },
];

async function createFakeVisionBinary(directory: string): Promise<string> {
  const path = join(directory, "fake-vision");
  const response = {
    schemaVersion: 1,
    provider: "apple-vision",
    image: { width: 1600, height: 900 },
    blocks: BLOCKS.map((block) => ({
      ...block,
      confidence: 0.95,
      rotationDeg: null,
      glyphHints: [],
    })),
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
  const stages = workspace.manifest.stages.map((s) =>
    s.stage === "assist-review"
      ? {
          ...s,
          status: "completed" as const,
          lastSuccessfulAttemptId: "assist-review-skip",
          completedInputFingerprint:
            "0000000000000000000000000000000000000000000000000000000000000000",
        }
      : s,
  );
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    stages,
  });
}

// 每块的人工复核前景色，供 mask 分割（对象内符号不参与 mask）。
const FOREGROUND: Record<string, string> = {
  title: "#ffffff",
  subtitle: "#c7d6f0",
  card: "#ffffff",
  art: "#fad16b",
};

describe("合成 fixture 五类元素端到端覆盖", () => {
  it("中文/混排/容器内文字/对象内符号/艺术字在全链路被正确处理", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-coverage-"));
    const workspacePath = join(parent, "slide");
    const binaryPath = await createFakeVisionBinary(parent);
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
    await runSlideOcr({ workspacePath, binaryPath });
    const review = await runSlideReview({ workspacePath });

    // 人工复核：四类版式文字参与 mask，对象内符号仅确认不参与 mask/文本框。
    const document = JSON.parse(
      await readFile(review.outputPath, "utf8"),
    ) as TextReviewDocument;
    document.blocks.forEach((block) => {
      block.reviewStatus = "reviewed";
      block.updatedAt = "2026-07-20T05:00:00.000Z";
      const source = block.sources[0];
      const kind = source?.text ?? "";
      if (kind === "85%") {
        block.classification = "object_integrated_symbol";
        block.includeInMask = false;
        return;
      }
      block.classification = "layout_text";
      block.includeInMask = true;
      const fg =
        kind === "全球营收概览"
          ? FOREGROUND.title
          : kind.startsWith("Global")
            ? FOREGROUND.subtitle
            : kind === "核心指标"
              ? FOREGROUND.card
              : FOREGROUND.art;
      block.maskParams.foregroundColors = [fg ?? "#ffffff"];
      block.maskParams.colorTolerance = 110;
    });
    await writeFile(
      review.outputPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );
    await markAssistReviewCompleted(workspacePath);

    const validation = await runSlideValidateReview({ workspacePath });
    expect(validation.report.status).toBe("passed");

    const mask = await runSlideMask({ workspacePath });
    const maskRecord = JSON.parse(
      await readFile(join(workspacePath, "stages/mask/record.json"), "utf8"),
    );
    // 对象内符号不进 mask：只掩盖四个版式文字块。
    expect(maskRecord.totals.maskedBlockCount).toBe(4);
    expect(mask.totalMaskedPixels).toBeGreaterThan(0);

    const cleanBuffer = await buildFakeCleanPlate(
      join(workspacePath, "inputs/source.png"),
      join(workspacePath, "stages/mask/mask.png"),
    );
    await runSlideClean({
      workspacePath,
      confirmUpload: true,
      edit: fakeEditor(cleanBuffer),
    });
    await runAcceptClean({ workspacePath, acceptedBy: "dev" });
    const pptx = await runSlidePptx({
      workspacePath,
      fontFace: FONT,
      doctorReport: fontReadyReport(),
    });
    expect(pptx.checkStatus).toBe("passed");

    const check = JSON.parse(
      await readFile(join(workspacePath, "stages/pptx/check.json"), "utf8"),
    );
    // 只有四个版式文字生成文本框，对象内符号留在 clean plate 位图。
    expect(check.shapes.textBoxes).toBe(4);
    expect(check.shapes.images).toBe(1);
    expect(check.fontDeclared).toBe(true);
    expect(check.missingTexts).toEqual([]);

    // 混排块（中英 + 中文年度）作为原生文本内容存在。
    const buffer = await readFile(
      join(workspacePath, "stages/pptx/slide.pptx"),
    );
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const slideXml =
      (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    expect(slideXml).toContain("Global Revenue Overview");
    expect(slideXml).toContain("财年");
    expect(slideXml).toContain("全球营收概览");
    expect(slideXml).toContain("限时优惠");
    expect(slideXml).not.toContain("85%"); // 对象内符号不进文本层

    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });
    const { report } = await runSlideReport({ workspacePath });
    expect(report.overallStatus).toBe("complete");
    expect(report.classification.layoutText).toBe(4);
    expect(report.classification.objectIntegratedSymbol).toBe(1);
  });
});
