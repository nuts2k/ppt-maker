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
import { runSlideRunFrom } from "../src/slide/run-from.js";
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

async function editReview(
  reviewPath: string,
  mutate: (doc: TextReviewDocument) => void,
): Promise<void> {
  const document = JSON.parse(
    await readFile(reviewPath, "utf8"),
  ) as TextReviewDocument;
  mutate(document);
  await writeFile(reviewPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function setupReviewedMask(): Promise<{
  workspacePath: string;
  reviewPath: string;
}> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-run-report-"));
  const workspacePath = join(parent, "slide");
  const binaryPath = await createFakeVisionBinary(parent);
  await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
  await runSlideOcr({ workspacePath, binaryPath });
  const review = await runSlideReview({ workspacePath });
  await editReview(review.outputPath, (doc) => {
    const title = doc.blocks[0];
    if (title !== undefined) {
      title.includeInMask = true;
      title.classification = "layout_text";
      title.reviewStatus = "reviewed";
      title.updatedAt = "2026-07-20T05:00:00.000Z";
      title.maskParams.foregroundColors = ["#ffffff"];
      title.maskParams.colorTolerance = 96;
    }
  });
  await markAssistReviewCompleted(workspacePath);
  await runSlideValidateReview({ workspacePath });
  await runSlideMask({ workspacePath });
  return { workspacePath, reviewPath: review.outputPath };
}

async function setupThroughPptx(): Promise<{
  workspacePath: string;
  reviewPath: string;
}> {
  const { workspacePath, reviewPath } = await setupReviewedMask();
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
  await runSlidePptx({
    workspacePath,
    fontFace: FONT,
    doctorReport: fontReadyReport(),
  });
  return { workspacePath, reviewPath };
}

describe("变更粒度失效矩阵", () => {
  it("仅改文字内容时 mask/clean 复用，只 PPTX 重跑", async () => {
    const { workspacePath, reviewPath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });

    // 内容变更（文字/换行），不改几何/分类/maskParams。
    await editReview(reviewPath, (doc) => {
      const title = doc.blocks[0];
      if (title !== undefined) {
        title.text = "全球营收概览 2026";
        title.lines = ["全球营收概览 2026"];
      }
    });
    await runSlideValidateReview({ workspacePath });

    const mask = await runSlideMask({ workspacePath });
    expect(mask.reused).toBe(true); // mask 投影未变
    const cleanBuffer = await buildFakeCleanPlate(
      join(workspacePath, "inputs/source.png"),
      join(workspacePath, "stages/mask/mask.png"),
    );
    const clean = await runSlideClean({
      workspacePath,
      confirmUpload: true,
      edit: fakeEditor(cleanBuffer),
    });
    expect(clean.reused).toBe(true); // clean 只依赖 mask.sha
    const pptx = await runSlidePptx({
      workspacePath,
      fontFace: FONT,
      doctorReport: fontReadyReport(),
    });
    expect(pptx.reused).toBe(false); // 内容变更只重跑 PPTX
  });

  it("改几何/mask 参数时 mask 与下游全部重跑", async () => {
    const { workspacePath, reviewPath } = await setupReviewedMask();
    const before = await runSlideMask({ workspacePath });
    expect(before.reused).toBe(true);

    await editReview(reviewPath, (doc) => {
      const title = doc.blocks[0];
      if (title !== undefined) {
        title.bboxPx = { x: 100, y: 48, width: 300, height: 50 };
      }
    });
    await runSlideValidateReview({ workspacePath });
    const after = await runSlideMask({ workspacePath });
    expect(after.reused).toBe(false); // 几何变更重跑 mask
  });
});

describe("slide run --from 停止点", () => {
  it("run --from review 生成候选后停在人工编辑门", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-run-"));
    const workspacePath = join(parent, "slide");
    const binaryPath = await createFakeVisionBinary(parent);
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
    await runSlideOcr({ workspacePath, binaryPath });

    const result = await runSlideRunFrom("review", { workspacePath });
    expect(result.executed).toContain("review");
    expect(result.stoppedAt).toBe("assist-review");
    expect(result.gate).toBe("api");
  });

  it("run --from validate-review 执行 mask 后停在上传门", async () => {
    const { workspacePath } = await setupReviewedMask();
    const result = await runSlideRunFrom("validate-review", { workspacePath });
    expect(result.executed).toEqual(["validate-review", "mask"]);
    expect(result.stoppedAt).toBe("clean");
    expect(result.gate).toBe("upload");
  });

  it("run --from pptx 执行 pptx 后停在人工接受门", async () => {
    const { workspacePath } = await setupThroughPptx();
    const result = await runSlideRunFrom("pptx", { workspacePath });
    expect(result.executed).toEqual(["pptx"]);
    expect(result.stoppedAt).toBe("accept-pptx");
    expect(result.gate).toBe("manual");
  });
});

describe("slide report", () => {
  it("未完成流水线汇总为 incomplete，自动检查与人工接受分开", async () => {
    const { workspacePath } = await setupThroughPptx();
    const { report } = await runSlideReport({ workspacePath });
    expect(report.overallStatus).toBe("incomplete"); // 未 accept-pptx
    expect(report.autoChecks.pptx?.status).toBe("passed");
    expect(report.manualAcceptance.pptx).toBeNull();
    expect(report.manualAcceptance.cleanPlate).not.toBeNull();
    expect(report.mask).not.toBeNull();
  });

  it("完整接受后汇总为 complete 并记录人工耗时", async () => {
    const { workspacePath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });
    const { report } = await runSlideReport({ workspacePath });
    expect(report.overallStatus).toBe("complete");
    expect(report.manualAcceptance.pptx?.stale).toBe(false);
    expect(report.manualReview.reviewToPptxAcceptMs).not.toBeNull();
    expect(report.classification.layoutText).toBe(1);
  });

  it("PPTX 自动检查失败不汇总为 complete", async () => {
    const { workspacePath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });
    // 篡改 pptx 检查报告为 failed（模拟自动检查未过）。
    const checkPath = join(workspacePath, "stages/pptx/check.json");
    const check = JSON.parse(await readFile(checkPath, "utf8"));
    check.status = "failed";
    await writeFile(checkPath, `${JSON.stringify(check, null, 2)}\n`, "utf8");
    const { report } = await runSlideReport({ workspacePath });
    expect(report.overallStatus).toBe("incomplete");
  });
});
