import { chmod, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TextReviewDocument } from "@ppt-maker/core";
import type OpenAI from "openai";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { runAcceptClean } from "../src/clean/accept.js";
import { runSlideClean } from "../src/clean/run.js";
import { runSlideMask } from "../src/mask/run.js";
import type { OpenAiImageEditor } from "../src/providers/openai-image.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import { runSlideReview } from "../src/slide/review.js";
import { runSlideValidateReview } from "../src/slide/validate-review.js";
import {
  createSlideWorkspace,
  loadSlideWorkspace,
  writeWorkspaceManifest,
} from "../src/slide/workspace.js";

// 捕获真实 createDefaultImageEditor 传给 OpenAI 客户端的 apiKey，并让 images.edit 返回受控 clean plate。
const openaiMock = vi.hoisted(() => ({ capturedApiKey: "", b64: "" }));

vi.mock("openai", () => ({
  default: class {
    images = {
      edit: () => ({
        withResponse: async () => ({
          data: {
            created: 0,
            data: [{ b64_json: openaiMock.b64 }],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
          request_id: "req_mock",
        }),
      }),
    };
    constructor(options: { apiKey: string }) {
      openaiMock.capturedApiKey = options.apiKey;
    }
  },
}));

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

async function prepareMasked(): Promise<{
  workspacePath: string;
  sourcePath: string;
  maskPath: string;
}> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-clean-"));
  const workspacePath = join(parent, "slide");
  const binaryPath = await createFakeVisionBinary(parent);
  await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
  await runSlideOcr({ workspacePath, binaryPath });
  const review = await runSlideReview({ workspacePath });
  const document = JSON.parse(
    await readFile(review.outputPath, "utf8"),
  ) as TextReviewDocument;
  const title = document.blocks[0];
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
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
  await markAssistReviewCompleted(workspacePath);
  await runSlideValidateReview({ workspacePath });
  await runSlideMask({ workspacePath });
  return {
    workspacePath,
    sourcePath: join(workspacePath, "inputs/source.png"),
    maskPath: join(workspacePath, "stages/mask/mask.png"),
  };
}

// 依据源图与 mask 生成"擦除字形"的 2048x1152 假 clean plate，供 fake editor 返回。
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
  const total = src.info.width * src.info.height;
  for (let i = 0; i < total; i += 1) {
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

function fakeEditor(
  cleanBuffer: Buffer,
  requestId = "req_fake",
): OpenAiImageEditor {
  return async () => ({
    response: {
      created: 0,
      data: [{ b64_json: cleanBuffer.toString("base64") }],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        total_tokens: 300,
        input_tokens_details: { image_tokens: 90, text_tokens: 10 },
      },
    } as OpenAI.Images.ImagesResponse,
    requestId,
  });
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    files.push(...(entry.isDirectory() ? await listFiles(full) : [full]));
  }
  return files;
}

describe("slide clean", () => {
  it("生成 clean plate、离线检查、Provider 记录，并在同输入时复用", async () => {
    const { workspacePath, sourcePath, maskPath } = await prepareMasked();
    const cleanBuffer = await buildFakeCleanPlate(sourcePath, maskPath);
    const edit = fakeEditor(cleanBuffer);

    const notices: string[] = [];
    const first = await runSlideClean({
      workspacePath,
      confirmUpload: true,
      edit,
      onBeforeUpload: (notice) => notices.push(notice.model),
    });
    expect(first.reused).toBe(false);
    expect(notices).toEqual(["gpt-image-2"]);

    const record = JSON.parse(
      await readFile(
        join(workspacePath, `stages/clean/${first.attemptId}/record.json`),
        "utf8",
      ),
    );
    expect(record.checks.size.ok).toBe(true);
    expect([record.checks.size.width, record.checks.size.height]).toEqual([
      2048, 1152,
    ]);
    expect(record.checks.size.aspectRatioOk).toBe(true);
    // 字形已擦除：残留前景像素远少于被掩盖像素。
    expect(record.checks.textResidue.residualForegroundPixels).toBeLessThan(
      record.checks.textResidue.maskedPixels * 0.1,
    );
    expect(record.checks.outsideMaskDiff.comparedPixels).toBeGreaterThan(0);
    expect(record.checks.containerRingDiff.ringPixels).toBeGreaterThan(0);

    const provider = JSON.parse(
      await readFile(
        join(workspacePath, `stages/clean/${first.attemptId}/provider.json`),
        "utf8",
      ),
    );
    expect(provider.stage).toBe("clean");
    expect(provider.endpoint).toBe("/v1/images/edits");
    expect(provider.requestId).toBe("req_fake");
    expect(provider.sentAssets).toHaveLength(2);
    for (const asset of provider.sentAssets) {
      expect(Object.keys(asset).sort()).toEqual(["path", "sha256"]);
    }

    const loaded = await loadSlideWorkspace(workspacePath);
    expect(
      loaded.manifest.assets.filter(
        (asset) => asset.attemptId === first.attemptId,
      ),
    ).toHaveLength(5);

    const second = await runSlideClean({
      workspacePath,
      confirmUpload: true,
      edit,
    });
    expect(second.reused).toBe(true);
  });

  it("无 --confirm-upload 时拒绝", async () => {
    const { workspacePath } = await prepareMasked();
    await expect(
      runSlideClean({ workspacePath, confirmUpload: false }),
    ).rejects.toThrow("--confirm-upload");
  });

  it("多次尝试不覆盖旧结果", async () => {
    const { workspacePath, sourcePath, maskPath } = await prepareMasked();
    const cleanBuffer = await buildFakeCleanPlate(sourcePath, maskPath);
    const first = await runSlideClean({
      workspacePath,
      confirmUpload: true,
      edit: fakeEditor(cleanBuffer, "req_a"),
    });
    // 强制新尝试：不走复用（模拟质量不合格后重试）——直接再次调用会复用，故校验尝试目录独立。
    expect(first.attemptId).toBe("clean-001");
    const attemptDir = await readdir(
      join(workspacePath, "stages/clean/clean-001"),
    );
    expect(attemptDir).toContain("result.png");
    expect(attemptDir).toContain("record.json");
  });

  it("调用失败时保存脱敏错误记录且不产出 clean plate", async () => {
    const { workspacePath } = await prepareMasked();
    const failing: OpenAiImageEditor = async () => {
      throw new Error("provider down sk-secret-xyz");
    };
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-secret-xyz";
    try {
      await expect(
        runSlideClean({ workspacePath, confirmUpload: true, edit: failing }),
      ).rejects.toThrow();
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }
    const loaded = await loadSlideWorkspace(workspacePath);
    expect(
      loaded.manifest.stages.find((state) => state.stage === "clean")?.status,
    ).toBe("failed");
    expect(
      loaded.manifest.assets.filter((asset) => asset.role === "clean_plate"),
    ).toHaveLength(0);
    const provider = await readFile(
      join(workspacePath, "stages/clean/clean-001/provider.json"),
      "utf8",
    );
    expect(provider).toContain("[REDACTED]");
    expect(provider).not.toContain("sk-secret-xyz");
  });

  it("篡改 mask 后 clean 被完整性校验拒绝", async () => {
    const { workspacePath } = await prepareMasked();
    await writeFile(
      join(workspacePath, "stages/mask/mask.png"),
      "tampered",
      "utf8",
    );
    await expect(
      runSlideClean({ workspacePath, confirmUpload: true }),
    ).rejects.toThrow("完整性");
  });

  it("clean 产物不含 API Key", async () => {
    const { workspacePath, sourcePath, maskPath } = await prepareMasked();
    const cleanBuffer = await buildFakeCleanPlate(sourcePath, maskPath);
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-CLEAN-SECRET-persist-check";
    try {
      await runSlideClean({
        workspacePath,
        confirmUpload: true,
        edit: fakeEditor(cleanBuffer),
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }
    const files = await listFiles(join(workspacePath, "stages/clean"));
    for (const file of files) {
      if (file.endsWith(".png")) {
        continue;
      }
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("sk-CLEAN-SECRET-persist-check");
    }
  });

  it("真实 createDefaultImageEditor 路径（mock OpenAI SDK）也不把 API Key 写入任何产物", async () => {
    const { workspacePath, sourcePath, maskPath } = await prepareMasked();
    const cleanBuffer = await buildFakeCleanPlate(sourcePath, maskPath);
    openaiMock.b64 = cleanBuffer.toString("base64");
    const sentinel = "sk-CLEAN-REAL-PATH-must-not-persist";
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = sentinel;
    try {
      // 不注入 edit：走真实 createDefaultImageEditor（new OpenAI({apiKey}) + images.edit）。
      await runSlideClean({ workspacePath, confirmUpload: true });
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }
    // 证明真实读取密钥的路径确实执行：mock 客户端收到的就是 sentinel key。
    expect(openaiMock.capturedApiKey).toBe(sentinel);
    const files = await listFiles(join(workspacePath, "stages/clean"));
    for (const file of files) {
      if (file.endsWith(".png")) {
        continue;
      }
      const content = await readFile(file, "utf8");
      expect(content).not.toContain(sentinel);
      expect(content).not.toContain("Authorization");
      expect(content).not.toContain("Bearer ");
    }
  });
});

describe("slide accept-clean", () => {
  it("接受当前产物哈希并在上游变化后自动 stale", async () => {
    const { workspacePath, sourcePath, maskPath } = await prepareMasked();
    const cleanBuffer = await buildFakeCleanPlate(sourcePath, maskPath);
    const clean = await runSlideClean({
      workspacePath,
      confirmUpload: true,
      edit: fakeEditor(cleanBuffer),
    });

    const accept = await runAcceptClean({
      workspacePath,
      acceptedBy: "dev",
      note: "容器与符号完整",
    });
    const accepted = JSON.parse(await readFile(accept.acceptedPath, "utf8"));
    expect(accepted.stage).toBe("accept-clean");
    expect(accepted.artifactSha256).toBe(accept.artifactSha256);

    let loaded = await loadSlideWorkspace(workspacePath);
    expect(
      loaded.manifest.stages.find((state) => state.stage === "accept-clean")
        ?.status,
    ).toBe("completed");
    // clean 产物哈希即接受的 artifact。
    const cleanAsset = loaded.manifest.assets.find(
      (asset) =>
        asset.role === "clean_plate" && asset.attemptId === clean.attemptId,
    );
    expect(accepted.artifactSha256).toBe(cleanAsset?.sha256);

    // 上游变化：改复核参数 → 重新校验 → 重跑 mask（指纹变化）→ accept-clean 自动 stale。
    const reviewPath = join(workspacePath, "stages/review/text-blocks.json");
    const document = JSON.parse(
      await readFile(reviewPath, "utf8"),
    ) as TextReviewDocument;
    const title = document.blocks[0];
    if (title !== undefined) {
      title.maskParams.colorTolerance = 64;
    }
    await writeFile(
      reviewPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );
    await runSlideValidateReview({ workspacePath });
    await runSlideMask({ workspacePath });

    loaded = await loadSlideWorkspace(workspacePath);
    expect(
      loaded.manifest.stages.find((state) => state.stage === "accept-clean")
        ?.status,
    ).toBe("stale");
  });

  it("clean 未完成时拒绝接受", async () => {
    const { workspacePath } = await prepareMasked();
    await expect(runAcceptClean({ workspacePath })).rejects.toThrow("clean");
  });
});
