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
import { runSlideOcr } from "../src/slide/ocr.js";
import { runSlideReview } from "../src/slide/review.js";
import { runSlideValidateReview } from "../src/slide/validate-review.js";
import {
  createSlideWorkspace,
  loadSlideWorkspace,
  writeWorkspaceManifest,
} from "../src/slide/workspace.js";

// 微软雅黑预检在无 PowerPoint 的 CI 会失败；显式传入字体名跳过可用性阻断（等价开发者断言字体存在）。
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

interface FakeBlock {
  readonly id: string;
  readonly text: string;
  readonly bboxPx: { x: number; y: number; width: number; height: number };
}

async function createFakeVisionBinary(
  directory: string,
  blocks: readonly FakeBlock[],
): Promise<string> {
  const path = join(directory, "fake-vision");
  const response = {
    schemaVersion: 1,
    provider: "apple-vision",
    image: { width: 1600, height: 900 },
    blocks: blocks.map((block) => ({
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

interface PrepareOptions {
  readonly blocks?: readonly FakeBlock[];
  readonly edit?: (doc: TextReviewDocument) => void;
}

const DEFAULT_BLOCKS: FakeBlock[] = [
  {
    id: "title",
    text: "全球营收概览",
    bboxPx: { x: 95, y: 44, width: 307, height: 54 },
  },
];

// 跑到 accept-clean：init→ocr→review→(置位复核)→validate-review→mask→clean→accept-clean。
async function prepareAcceptedClean(
  options: PrepareOptions = {},
): Promise<{ workspacePath: string; reviewPath: string }> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-pptx-"));
  const workspacePath = join(parent, "slide");
  const binaryPath = await createFakeVisionBinary(
    parent,
    options.blocks ?? DEFAULT_BLOCKS,
  );
  await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
  await runSlideOcr({ workspacePath, binaryPath });
  const review = await runSlideReview({ workspacePath });
  const document = JSON.parse(
    await readFile(review.outputPath, "utf8"),
  ) as TextReviewDocument;
  // 默认把第一个块置为已复核 layout_text 并参与 mask。
  const first = document.blocks[0];
  if (first !== undefined) {
    first.includeInMask = true;
    first.classification = "layout_text";
    first.reviewStatus = "reviewed";
    first.updatedAt = "2026-07-20T05:00:00.000Z";
    first.maskParams.foregroundColors = ["#ffffff"];
    first.maskParams.colorTolerance = 96;
  }
  options.edit?.(document);
  await writeFile(
    review.outputPath,
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
  await markAssistReviewCompleted(workspacePath);
  await runSlideValidateReview({ workspacePath });
  await runSlideMask({ workspacePath });
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
  return { workspacePath, reviewPath: review.outputPath };
}

describe("slide pptx", () => {
  it("合成 16:9 可编辑 PPTX 并通过自动检查", async () => {
    const { workspacePath } = await prepareAcceptedClean();
    const result = await runSlidePptx({
      workspacePath,
      fontFace: FONT,
      doctorReport: fontReadyReport(),
    });
    expect(result.reused).toBe(false);
    expect(result.checkStatus).toBe("passed");

    const check = JSON.parse(
      await readFile(join(workspacePath, "stages/pptx/check.json"), "utf8"),
    );
    expect(check.status).toBe("passed");
    expect(check.layout.aspectRatioOk).toBe(true);
    expect(check.shapes.images).toBe(1);
    expect(check.shapes.textBoxes).toBe(1);
    expect(check.fontDeclared).toBe(true);
    expect(check.missingTexts).toEqual([]);

    const record = JSON.parse(
      await readFile(join(workspacePath, "stages/pptx/record.json"), "utf8"),
    );
    expect(record.fontFace).toBe(FONT);
    expect(record.fontFallback).toBe(false);
    expect(record.textBoxCount).toBe(1);

    const second = await runSlidePptx({
      workspacePath,
      fontFace: FONT,
      doctorReport: fontReadyReport(),
    });
    expect(second.reused).toBe(true);
  });

  it("对象内符号块不生成文本框", async () => {
    const { workspacePath } = await prepareAcceptedClean({
      blocks: [
        {
          id: "title",
          text: "全球营收概览",
          bboxPx: { x: 95, y: 44, width: 307, height: 54 },
        },
        {
          id: "sym",
          text: "85%",
          bboxPx: { x: 709, y: 358, width: 105, height: 65 },
        },
      ],
      edit: (doc) => {
        const symbol = doc.blocks[1];
        if (symbol !== undefined) {
          symbol.classification = "object_integrated_symbol";
          symbol.reviewStatus = "reviewed";
          symbol.updatedAt = "2026-07-20T05:00:00.000Z";
        }
      },
    });
    const result = await runSlidePptx({
      workspacePath,
      fontFace: FONT,
      doctorReport: fontReadyReport(),
    });
    const check = JSON.parse(
      await readFile(join(workspacePath, "stages/pptx/check.json"), "utf8"),
    );
    expect(result.checkStatus).toBe("passed");
    expect(check.shapes.textBoxes).toBe(1);
  });

  it("存在未复核版式文字时拒绝导出", async () => {
    const { workspacePath, reviewPath } = await prepareAcceptedClean();
    const document = JSON.parse(
      await readFile(reviewPath, "utf8"),
    ) as TextReviewDocument;
    const first = document.blocks[0];
    if (first !== undefined) {
      first.reviewStatus = "unreviewed";
    }
    await writeFile(
      reviewPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );
    await expect(
      runSlidePptx({
        workspacePath,
        fontFace: FONT,
        doctorReport: fontReadyReport(),
      }),
    ).rejects.toThrow("未复核");
  });

  it("clean plate 未接受时拒绝导出", async () => {
    // 只跑到 mask，不做 clean/accept-clean。
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-pptx-"));
    const workspacePath = join(parent, "slide");
    const binaryPath = await createFakeVisionBinary(parent, DEFAULT_BLOCKS);
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
    await runSlideOcr({ workspacePath, binaryPath });
    const review = await runSlideReview({ workspacePath });
    const document = JSON.parse(
      await readFile(review.outputPath, "utf8"),
    ) as TextReviewDocument;
    const first = document.blocks[0];
    if (first !== undefined) {
      first.includeInMask = true;
      first.classification = "layout_text";
      first.reviewStatus = "reviewed";
      first.updatedAt = "2026-07-20T05:00:00.000Z";
      first.maskParams.foregroundColors = ["#ffffff"];
      first.maskParams.colorTolerance = 96;
    }
    await writeFile(
      review.outputPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );
    await markAssistReviewCompleted(workspacePath);
    await runSlideValidateReview({ workspacePath });
    await runSlideMask({ workspacePath });
    await expect(
      runSlidePptx({
        workspacePath,
        fontFace: FONT,
        doctorReport: fontReadyReport(),
      }),
    ).rejects.toThrow("accept-clean");
  });

  it("clean 接受记录因上游变化 stale 后拒绝导出", async () => {
    const { workspacePath, reviewPath } = await prepareAcceptedClean();
    // accept-clean 此时 completed；改 mask 参数 → 重跑 validate/mask（指纹变化）
    // → invalidateStageAndDownstream 使 clean 与 accept-clean stale（未重新 clean/accept）。
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
    await runSlideValidateReview({ workspacePath });
    await runSlideMask({ workspacePath });

    const loaded = await loadSlideWorkspace(workspacePath);
    expect(
      loaded.manifest.stages.find((state) => state.stage === "accept-clean")
        ?.status,
    ).toBe("stale");
    await expect(
      runSlidePptx({
        workspacePath,
        fontFace: FONT,
        doctorReport: fontReadyReport(),
      }),
    ).rejects.toThrow("accept-clean");
  });

  it("坐标与样式映射到英寸/磅", async () => {
    const { workspacePath } = await prepareAcceptedClean();
    await runSlidePptx({
      workspacePath,
      fontFace: FONT,
      doctorReport: fontReadyReport(),
    });
    // slide1.xml 中文本框偏移应约为 95/1600*13.333 英寸 → EMU（1 英寸 = 914400 EMU）。
    const { default: JSZip } = await import("jszip");
    const buffer = await readFile(
      join(workspacePath, "stages/pptx/slide.pptx"),
    );
    const zip = await JSZip.loadAsync(buffer);
    const slideXml =
      (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    const off = slideXml.match(/<a:off x="(\d+)" y="(\d+)"/u);
    expect(off).not.toBeNull();
    const expectedX = Math.round((95 / 1600) * 13.333 * 914400);
    const actualX = Number(off?.[1] ?? 0);
    // 背景图 off 为 0，取文本框的 off（第二个匹配）更稳妥。
    const allOff = [...slideXml.matchAll(/<a:off x="(\d+)" y="(\d+)"/gu)];
    const textOff = allOff.find((match) => Number(match[1]) > 0);
    expect(Number(textOff?.[1] ?? actualX)).toBeGreaterThan(expectedX * 0.9);
    expect(Number(textOff?.[1] ?? actualX)).toBeLessThan(expectedX * 1.1);
  });
});

describe("slide accept-pptx", () => {
  it("记录人工检查与产物哈希并在上游变化后 stale", async () => {
    const { workspacePath, reviewPath } = await prepareAcceptedClean();
    const pptx = await runSlidePptx({
      workspacePath,
      fontFace: FONT,
      doctorReport: fontReadyReport(),
    });
    const accept = await runAcceptPptx({
      workspacePath,
      acceptedBy: "dev",
      note: "PowerPoint for Mac 可打开可编辑",
    });
    const accepted = JSON.parse(await readFile(accept.acceptedPath, "utf8"));
    expect(accepted.stage).toBe("accept-pptx");
    expect(accepted.artifactSha256).toBe(accept.artifactSha256);

    let loaded = await loadSlideWorkspace(workspacePath);
    const pptxAsset = loaded.manifest.assets.find(
      (asset) => asset.role === "pptx" && asset.attemptId === pptx.attemptId,
    );
    expect(accepted.artifactSha256).toBe(pptxAsset?.sha256);
    expect(
      loaded.manifest.stages.find((state) => state.stage === "accept-pptx")
        ?.status,
    ).toBe("completed");

    // 上游变化：改文本内容 → 重跑 pptx（指纹变化）→ accept-pptx 自动 stale。
    const document = JSON.parse(
      await readFile(reviewPath, "utf8"),
    ) as TextReviewDocument;
    const first = document.blocks[0];
    if (first !== undefined) {
      first.text = "全球营收概览 2026";
      first.lines = ["全球营收概览 2026"];
    }
    await writeFile(
      reviewPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );
    await runSlidePptx({
      workspacePath,
      fontFace: FONT,
      doctorReport: fontReadyReport(),
    });

    loaded = await loadSlideWorkspace(workspacePath);
    expect(
      loaded.manifest.stages.find((state) => state.stage === "accept-pptx")
        ?.status,
    ).toBe("stale");
  });

  it("pptx 未完成时拒绝接受", async () => {
    const { workspacePath } = await prepareAcceptedClean();
    await expect(runAcceptPptx({ workspacePath })).rejects.toThrow("pptx");
  });
});
