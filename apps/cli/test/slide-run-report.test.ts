import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
import { runAcceptFinal } from "../src/slide/accept-final.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import { runSlideReview } from "../src/slide/review.js";
import { runSlideRunFrom } from "../src/slide/run-from.js";
import { runSlideValidateReview } from "../src/slide/validate-review.js";
import {
  createSlideWorkspace,
  createWorkspaceAsset,
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

// 跑到 pptx 但不做任何人工验收——最终产物确认前的真实状态。
async function setupThroughPptxUnaccepted(): Promise<{
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
  await runSlidePptx({
    workspacePath,
    fontFace: FONT,
    doctorReport: fontReadyReport(),
  });
  return { workspacePath, reviewPath };
}

async function setupThroughPptx(): Promise<{
  workspacePath: string;
  reviewPath: string;
}> {
  const setup = await setupThroughPptxUnaccepted();
  await runAcceptClean({
    workspacePath: setup.workspacePath,
    acceptedBy: "dev",
  });
  return setup;
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

  it("run --from pptx 执行 pptx 后停在最终确认门", async () => {
    const { workspacePath } = await setupThroughPptx();
    const result = await runSlideRunFrom("pptx", { workspacePath });
    expect(result.executed).toEqual(["pptx"]);
    expect(result.stoppedAt).toBe("accept-pptx");
    expect(result.gate).toBe("manual");
    expect(result.nextCommand).toContain("accept-final");
  });

  // B7：mask 会把版式文字从底板抹掉，抹之前必须有人确认过文字内容。
  // 此前这一步靠 mask/run.ts 抛 INVALID_STAGE_STATE 代偿，表现为「阶段执行失败」
  // 而非「停下等人复核」（PRD F-11）。
  it("存在未复核版式文字时停在文本复核门", async () => {
    const { workspacePath, reviewPath } = await setupReviewedMask();
    await editReview(reviewPath, (doc) => {
      const title = doc.blocks[0];
      if (title !== undefined) {
        title.reviewStatus = "unreviewed";
      }
    });
    await runSlideValidateReview({ workspacePath });

    const result = await runSlideRunFrom("mask", { workspacePath });
    expect(result.gate).toBe("human-edit");
    // 语义是回到 review 产物做人工复核，而不是「mask 阶段出错」。
    expect(result.stoppedAt).toBe("review");
    expect(result.executed).toEqual([]);
    expect(result.message).toContain("1");
  });

  // B8：复核齐备后 accept-clean 不再产生停顿，一路直通到最终确认。
  it("复核齐备后直通至最终确认门且 accept-clean 未停顿", async () => {
    const { workspacePath } = await setupReviewedMask();
    const cleanBuffer = await buildFakeCleanPlate(
      join(workspacePath, "inputs/source.png"),
      join(workspacePath, "stages/mask/mask.png"),
    );
    await runSlideClean({
      workspacePath,
      confirmUpload: true,
      edit: fakeEditor(cleanBuffer),
    });

    const result = await runSlideRunFrom("clean", {
      workspacePath,
      confirmUpload: true,
    });
    expect(result.stoppedAt).toBe("accept-pptx");
    expect(result.gate).toBe("manual");
    expect(result.executed).toContain("pptx");
    // clean 未验收也能合成 PPTX：验收统一移到最终产物确认。
    const loaded = await loadSlideWorkspace(workspacePath);
    expect(
      loaded.manifest.stages.find((state) => state.stage === "accept-clean")
        ?.status,
    ).not.toBe("completed");
  });

  // B10：既有已完成页走新逻辑不产生任何停顿。
  it("两个验收均已完成的页继续 run 不停顿", async () => {
    const { workspacePath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });
    const result = await runSlideRunFrom("pptx", { workspacePath });
    expect(result.gate).toBeNull();
    expect(result.stoppedAt).toBeNull();
  });

  /*
   * 缺陷回归（2026-08-02 阶段三走查）：11 页全部 completed 的 deck 再跑一次
   * `deck run`，11 页的目录 shasum 全变。守卫只写在 assist-review / clean /
   * accept-pptx 三个分支上，而 report 既没有守卫、函数内部也没有指纹复用，
   * 于是每 run 一次就重写一遍 report.json 并追加一条 attempt（实测已累积 9 条）；
   * validate-review 是瞬态阶段，同样每次重写 validation.json 的 checkedAt。
   *
   * 断言落在**磁盘字节**上而不是返回值：这条不变量的名字就是「已完成页零变化」。
   */
  it("已跑完的页再 run 一次：report 与 validation 逐字节不变，attempt 不增", async () => {
    const { workspacePath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });

    const validationPath = join(workspacePath, "stages/review/validation.json");
    const reportPath = join(workspacePath, "stages/report/report.json");
    const manifestPath = join(workspacePath, "manifest.json");
    const validationBefore = await readFile(validationPath, "utf8");

    const first = await runSlideRunFrom("validate-review", { workspacePath });
    expect(first.executed).toContain("report");
    // 复核稿一字未改，validate-review 复用既有结论而不是重写一份新 checkedAt
    expect(await readFile(validationPath, "utf8")).toBe(validationBefore);

    const reportBefore = await readFile(reportPath, "utf8");
    const manifestBefore = await readFile(manifestPath, "utf8");

    const second = await runSlideRunFrom("validate-review", { workspacePath });
    expect(second.gate).toBeNull();
    expect(second.executed).not.toContain("report");
    expect(await readFile(reportPath, "utf8")).toBe(reportBefore);
    expect(await readFile(validationPath, "utf8")).toBe(validationBefore);
    expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);

    const workspace = await loadSlideWorkspace(workspacePath);
    expect(
      workspace.manifest.attempts.filter(
        (attempt) => attempt.stage === "report",
      ),
    ).toHaveLength(1);
  });

  it("report 被失效后 run 会真的重跑它", async () => {
    // 守卫的另一半：跳过的判据只认 completed，stale 必须重跑，
    // 否则「从阶段 X 重跑」这类入口会退化成毫秒空转。
    const { workspacePath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });
    await runSlideRunFrom("pptx", { workspacePath });

    const { manifest } = await loadSlideWorkspace(workspacePath);
    await writeWorkspaceManifest(workspacePath, {
      ...manifest,
      stages: manifest.stages.map((state) =>
        state.stage === "report"
          ? {
              ...state,
              status: "stale" as const,
              invalidatedAt: "2026-08-02T00:00:00.000Z",
              invalidationReason: "人工要求重跑",
            }
          : state,
      ),
    });

    const result = await runSlideRunFrom("pptx", { workspacePath });
    expect(result.executed).toContain("report");
    const after = await loadSlideWorkspace(workspacePath);
    expect(
      after.manifest.attempts.filter((attempt) => attempt.stage === "report"),
    ).toHaveLength(2);
  });
});

describe("slide accept-final", () => {
  // B9：一次动作写入两条验收记录，结构与单步 accept-clean / accept-pptx 一致。
  it("写入 clean 与 pptx 两条验收记录且结构与单步一致", async () => {
    const { workspacePath } = await setupThroughPptxUnaccepted();
    const result = await runAcceptFinal({ workspacePath, acceptedBy: "dev" });
    expect(result.cleanAcceptanceId).toBe("accept-clean-001");
    expect(result.pptxAcceptanceId).toBe("accept-pptx-001");

    const loaded = await loadSlideWorkspace(workspacePath);
    for (const stage of ["accept-clean", "accept-pptx"] as const) {
      const state = loaded.manifest.stages.find(
        (candidate) => candidate.stage === stage,
      );
      expect(state?.status).toBe("completed");
      expect(state?.lastSuccessfulAttemptId).not.toBeNull();
    }
    const cleanAcceptance = JSON.parse(
      await readFile(join(workspacePath, "stages/clean/accepted.json"), "utf8"),
    ) as { stage: string; note: string; checklist: Record<string, boolean> };
    const pptxAcceptance = JSON.parse(
      await readFile(join(workspacePath, "stages/pptx/accepted.json"), "utf8"),
    ) as { stage: string; note: string; checklist: Record<string, boolean> };
    expect(cleanAcceptance.stage).toBe("accept-clean");
    expect(pptxAcceptance.stage).toBe("accept-pptx");
    expect(cleanAcceptance.note).toContain("经最终产物确认统一验收");
    expect(pptxAcceptance.note).toContain("经最终产物确认统一验收");
    // 未传备注时不留尾随冒号
    expect(cleanAcceptance.note).toBe("经最终产物确认统一验收");
    /**
     * 清单留空：最终确认页展示的是自动检查指标，没有逐项人工勾选框，照抄单步验收
     * 的恒 true DEFAULT_CHECKLIST 会写出与自动检查矛盾的假记录（E1 走查实测：
     * `sizeCorrect: true` 撞上 `size.ok: false`）。空清单如实表示「本步无人工勾选」。
     */
    expect(cleanAcceptance.checklist).toEqual({});
    expect(pptxAcceptance.checklist).toEqual({});
  });

  it("传入备注时以冒号接在统一前缀之后", async () => {
    const { workspacePath } = await setupThroughPptxUnaccepted();
    await runAcceptFinal({
      workspacePath,
      acceptedBy: "dev",
      note: "字号偏小",
    });
    const cleanAcceptance = JSON.parse(
      await readFile(join(workspacePath, "stages/clean/accepted.json"), "utf8"),
    ) as { note: string };
    expect(cleanAcceptance.note).toBe("经最终产物确认统一验收：字号偏小");
  });

  it("重复调用幂等：状态不变且不追加 attempt", async () => {
    const { workspacePath } = await setupThroughPptxUnaccepted();
    const first = await runAcceptFinal({ workspacePath, acceptedBy: "dev" });
    const afterFirst = await loadSlideWorkspace(workspacePath);
    const countAttempts = (manifest: typeof afterFirst.manifest): number =>
      manifest.attempts.filter(
        (attempt) =>
          attempt.stage === "accept-clean" || attempt.stage === "accept-pptx",
      ).length;

    const second = await runAcceptFinal({ workspacePath, acceptedBy: "dev" });
    const afterSecond = await loadSlideWorkspace(workspacePath);
    expect(second.cleanAcceptanceId).toBe(first.cleanAcceptanceId);
    expect(second.pptxAcceptanceId).toBe(first.pptxAcceptanceId);
    expect(countAttempts(afterSecond.manifest)).toBe(
      countAttempts(afterFirst.manifest),
    );
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

  it("落库 report 阶段状态与 attempt", async () => {
    // 缺陷回归：此前 runSlideReport 只写 assets，完全没碰 stages/attempts，
    // report 状态恒为 pending —— 每次 run 都从 report 起跑、每次都成功、
    // 每次都不改状态，界面上表现为「点了没反应」，用户只能反复点。
    // 本文件既有的用例全部只断言 report 内容，这正是该缺陷能存活的原因。
    const { workspacePath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });
    const { report } = await runSlideReport({ workspacePath });

    const workspace = await loadSlideWorkspace(workspacePath);
    const state = workspace.manifest.stages.find(
      (candidate) => candidate.stage === "report",
    );
    expect(state?.status).toBe("completed");
    expect(state?.lastSuccessfulAttemptId).toBe("report-001");
    expect(state?.completedInputFingerprint).not.toBeNull();

    const attempts = workspace.manifest.attempts.filter(
      (attempt) => attempt.stage === "report",
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("completed");

    // 报告自身也须记为 completed，否则它把自己写成 pending
    expect(
      report.stages.find((entry) => entry.stage === "report")?.status,
    ).toBe("completed");
  });

  it("重跑 report 递增 attempt 编号而非覆盖", async () => {
    const { workspacePath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });
    await runSlideReport({ workspacePath });
    await runSlideReport({ workspacePath });

    const workspace = await loadSlideWorkspace(workspacePath);
    const attempts = workspace.manifest.attempts.filter(
      (attempt) => attempt.stage === "report",
    );
    expect(attempts.map((attempt) => attempt.id)).toEqual([
      "report-001",
      "report-002",
    ]);
    const state = workspace.manifest.stages.find(
      (candidate) => candidate.stage === "report",
    );
    expect(state?.latestAttemptId).toBe("report-002");
  });

  it("同一 role 有多条 attempt 记录时取当前成功那条", async () => {
    // 缺陷回归：此前按 role 取第一条匹配资产，真实工作区里 clean 跑过两次、
    // clean_record 有 clean-001 与 clean-002 两条，报告读到的是早已被取代的那条，
    // 于是把上一版底板的检查指标写进 report.json。
    const { workspacePath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });

    const workspace = await loadSlideWorkspace(workspacePath);
    const manifest = workspace.manifest;
    const currentClean = manifest.assets.find(
      (asset) => asset.role === "clean_record",
    );
    const currentPptxCheck = manifest.assets.find(
      (asset) => asset.role === "pptx_check",
    );
    if (currentClean === undefined || currentPptxCheck === undefined) {
      throw new Error("测试前置不成立：缺少 clean_record 或 pptx_check 资产");
    }

    // 伪造两条「更早的尝试」，内容与当前记录明显不同，且排在 assets 数组前面：
    // 按 role 取第一条就会命中它们。
    const staleCleanPath = "stages/clean/attempt-000.json";
    const staleClean = JSON.parse(
      await readFile(join(workspacePath, currentClean.path), "utf8"),
    );
    staleClean.attemptId = "clean-000";
    staleClean.checks.textResidue.residualRatio = 0.99;
    await writeFile(
      join(workspacePath, staleCleanPath),
      `${JSON.stringify(staleClean, null, 2)}\n`,
      "utf8",
    );

    const stalePptxCheckPath = "stages/pptx/check-000.json";
    const stalePptxCheck = JSON.parse(
      await readFile(join(workspacePath, currentPptxCheck.path), "utf8"),
    );
    stalePptxCheck.status = "failed";
    await writeFile(
      join(workspacePath, stalePptxCheckPath),
      `${JSON.stringify(stalePptxCheck, null, 2)}\n`,
      "utf8",
    );

    await writeWorkspaceManifest(workspace.path, {
      ...manifest,
      assets: [
        {
          ...currentClean,
          id: "asset-clean-000",
          path: staleCleanPath,
          attemptId: "clean-000",
        },
        {
          ...currentPptxCheck,
          id: "asset-pptx-check-000",
          path: stalePptxCheckPath,
          attemptId: "pptx-000",
        },
        ...manifest.assets,
      ],
    });

    const { report } = await runSlideReport({ workspacePath });
    expect(report.autoChecks.cleanPlate?.textResidue.residualRatio).not.toBe(
      0.99,
    );
    expect(report.autoChecks.pptx?.status).toBe("passed");
  });

  it("OCR 跑过多轮时发现数取当前那轮，不取上一轮", async () => {
    // 同上一条的同类缺陷，漏在 ocr_result 上：换源后 OCR 重跑会留下两条，
    // 归档/旧那条排在前面，按裸 role 取首条就把旧图的块数写进 report.json。
    const { workspacePath } = await setupThroughPptx();
    await runAcceptPptx({ workspacePath, acceptedBy: "dev" });

    const workspace = await loadSlideWorkspace(workspacePath);
    const manifest = workspace.manifest;
    const currentOcr = manifest.assets.find(
      (asset) => asset.role === "ocr_result",
    );
    if (currentOcr === undefined) {
      throw new Error("测试前置不成立：缺少 ocr_result 资产");
    }

    // 上一轮 OCR 的产物：块数与当前明显不同（fake Vision 只发 1 块）
    const staleOcrPath = "stages/ocr/ocr-000/result.json";
    const staleOcr = JSON.parse(
      await readFile(join(workspacePath, currentOcr.path), "utf8"),
    ) as { blocks: unknown[] };
    staleOcr.blocks = [...staleOcr.blocks, ...staleOcr.blocks];
    await mkdir(join(workspacePath, "stages/ocr/ocr-000"), { recursive: true });
    await writeFile(
      join(workspacePath, staleOcrPath),
      `${JSON.stringify(staleOcr, null, 2)}\n`,
      "utf8",
    );

    await writeWorkspaceManifest(workspace.path, {
      ...manifest,
      assets: [
        {
          ...currentOcr,
          id: "asset-ocr-000-result",
          path: staleOcrPath,
          attemptId: "ocr-000",
        },
        ...manifest.assets,
      ],
    });

    const { report } = await runSlideReport({ workspacePath });
    expect(report.discovery.ocrBlockCount).toBe(1);
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

  /*
   * 缺陷回归（2026-08-02 阶段三走查）：跑过两次生成的页在报告里出现两条
   * `stage: "init"`，model 相同、`requestId` 都是 null（第三方代理不回传
   * `x-request-id`），只有 durationMs 能勉强区分，回答不了「哪一条对应当前这张图」。
   *
   * 夹具刻意复刻真实形态：**同一 stage 两条 provider_record，分属两代 attempt**。
   * 只造一条的夹具会让这个缺陷全程隐身。
   */
  it("providerCalls 带 attemptId，多代生成可区分", async () => {
    const { workspacePath } = await setupThroughPptx();

    const { manifest } = await loadSlideWorkspace(workspacePath);
    const extra = [];
    for (const attemptId of ["init-001", "init-002"] as const) {
      const relativePath = `stages/init/${attemptId}/provider.json`;
      const absolutePath = join(workspacePath, relativePath);
      await mkdir(join(workspacePath, `stages/init/${attemptId}`), {
        recursive: true,
      });
      await writeFile(
        absolutePath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: `provider-${attemptId}`,
            stage: "init",
            provider: "openai",
            endpoint: "/v1/images/generations",
            model: "gpt-image-2",
            parameters: { size: "2048x1152" },
            promptVersion: "m5-generate-v1",
            sentAssets: [],
            requestId: null,
            startedAt: "2026-08-02T00:00:00.000Z",
            endedAt: "2026-08-02T00:00:10.000Z",
            durationMs: 10000,
            usage: { total_tokens: 1449 },
            error: null,
            rawResponsePath: null,
            rawResponseSha256: null,
            parsedResponsePath: null,
            parsedResponseSha256: null,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      extra.push(
        await createWorkspaceAsset(absolutePath, {
          schemaVersion: 1,
          id: `asset-${attemptId}-provider-record`,
          path: relativePath,
          role: "provider_record",
          createdAt: "2026-08-02T00:00:10.000Z",
          producedBy: "init",
          attemptId,
          image: null,
        }),
      );
    }
    await writeWorkspaceManifest(workspacePath, {
      ...manifest,
      assets: [...extra, ...manifest.assets],
    });

    const { report } = await runSlideReport({ workspacePath });
    const initCalls = report.providerCalls.filter(
      (call) => call.stage === "init",
    );
    expect(initCalls.map((call) => call.attemptId)).toEqual([
      "init-001",
      "init-002",
    ]);

    // 每条都与承载它的资产自洽，不是凭 id 字符串裁出来的
    const workspace = await loadSlideWorkspace(workspacePath);
    const byAttempt = new Map(
      workspace.manifest.assets
        .filter((asset) => asset.role === "provider_record")
        .map((asset) => [asset.attemptId, asset.path]),
    );
    for (const call of report.providerCalls) {
      expect(byAttempt.has(call.attemptId)).toBe(true);
    }
  });
});
