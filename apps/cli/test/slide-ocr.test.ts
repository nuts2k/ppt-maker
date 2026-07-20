import { appendFile, chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runSlideOcr } from "../src/slide/ocr.js";
import {
  createSlideWorkspace,
  loadSlideWorkspace,
  writeWorkspaceManifest,
} from "../src/slide/workspace.js";

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
        text: "你好 PPT Maker",
        bboxPx: { x: 120, y: 100, width: 480, height: 80 },
        confidence: 0.98,
        rotationDeg: null,
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

describe("slide ocr", () => {
  it("记录成功尝试并在输入未变化时复用产物", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-ocr-"));
    const workspacePath = join(parent, "slide");
    const binaryPath = await createFakeVisionBinary(parent);
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });

    const first = await runSlideOcr({ workspacePath, binaryPath });
    const second = await runSlideOcr({ workspacePath, binaryPath });
    const loaded = await loadSlideWorkspace(workspacePath);

    expect(first.reused).toBe(false);
    expect(second).toMatchObject({
      attemptId: first.attemptId,
      outputPath: first.outputPath,
      reused: true,
    });
    expect(
      loaded.manifest.attempts.filter((attempt) => attempt.stage === "ocr"),
    ).toHaveLength(1);
    expect(
      loaded.manifest.stages.find((stage) => stage.stage === "ocr"),
    ).toMatchObject({
      status: "completed",
      lastSuccessfulAttemptId: "ocr-001",
    });
  });

  it("失败时保留尝试记录且不伪造 OCR 资产", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-ocr-"));
    const workspacePath = join(parent, "slide");
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });

    await expect(
      runSlideOcr({
        workspacePath,
        binaryPath: join(parent, "missing-vision"),
      }),
    ).rejects.toThrow("尚未构建");
    const loaded = await loadSlideWorkspace(workspacePath);
    expect(
      loaded.manifest.stages.find((stage) => stage.stage === "ocr")?.status,
    ).toBe("failed");
    expect(
      loaded.manifest.assets.filter((asset) => asset.role === "ocr_result"),
    ).toHaveLength(0);
    expect(loaded.manifest.attempts.at(-1)).toMatchObject({
      stage: "ocr",
      status: "failed",
    });
  });

  it("OCR 输入指纹变化时使已完成下游阶段失效", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-slide-ocr-"));
    const workspacePath = join(parent, "slide");
    const binaryPath = await createFakeVisionBinary(parent);
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
    await runSlideOcr({ workspacePath, binaryPath });

    const loaded = await loadSlideWorkspace(workspacePath);
    await writeWorkspaceManifest(workspacePath, {
      ...loaded.manifest,
      stages: loaded.manifest.stages.map((stage) =>
        stage.stage === "review"
          ? {
              ...stage,
              status: "completed",
              latestAttemptId: "review-001",
              lastSuccessfulAttemptId: "review-001",
              completedInputFingerprint: "c".repeat(64),
            }
          : stage,
      ),
    });
    await appendFile(binaryPath, "// provider revision\n", "utf8");

    await runSlideOcr({ workspacePath, binaryPath });
    const rerun = await loadSlideWorkspace(workspacePath);
    expect(
      rerun.manifest.stages.find((stage) => stage.stage === "review"),
    ).toMatchObject({
      status: "stale",
      invalidationReason: "OCR 输入指纹变化",
    });
  });
});
