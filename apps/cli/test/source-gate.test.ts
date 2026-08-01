import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertStageDependenciesCompleted,
  type SlideSourceDraft,
} from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { runAcceptSource } from "../src/slide/accept-source.js";
import { runSlideRunFrom } from "../src/slide/run-from.js";
import {
  createSlideWorkspace,
  loadSlideWorkspace,
} from "../src/slide/workspace.js";

const HASH = "a".repeat(64);

const GENERATED: SlideSourceDraft = {
  kind: "generated",
  specEntryId: "entry-4",
  specEntrySha256: HASH,
  providerId: "openai",
  model: "gpt-image-2",
  promptVersion: "v1",
  promptSha256: HASH,
  parameters: { size: "2048x1152" },
};

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

async function createWorkspace(source?: SlideSourceDraft): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-source-gate-"));
  const workspacePath = join(parent, "slide");
  await createSlideWorkspace({
    imagePath: fixturePath(),
    workspacePath,
    ...(source === undefined ? {} : { source }),
  });
  return workspacePath;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function stageStatus(
  manifest: { stages: readonly { stage: string; status: string }[] },
  stage: string,
): string | undefined {
  return manifest.stages.find((state) => state.stage === stage)?.status;
}

describe("源图确认闸门", () => {
  it("生成图停在待确认，且 ocr 被依赖守卫拒绝", async () => {
    const workspacePath = await createWorkspace(GENERATED);
    const { manifest } = await loadSlideWorkspace(workspacePath);

    expect(manifest.source.kind).toBe("generated");
    expect(stageStatus(manifest, "accept-source")).toBe("pending");
    // 闸门由 core 兜底：不是靠调用方自觉先检查，而是根本跑不动
    expect(() =>
      assertStageDependenciesCompleted(manifest.stages, "ocr"),
    ).toThrow("accept-source");
  });

  it("导入图自动放行，但磁盘上没有 accepted.json", async () => {
    const workspacePath = await createWorkspace();
    const { manifest } = await loadSlideWorkspace(workspacePath);

    expect(stageStatus(manifest, "accept-source")).toBe("completed");
    expect(() =>
      assertStageDependenciesCompleted(manifest.stages, "ocr"),
    ).not.toThrow();

    // 判据就是这个文件在不在：写一条 acceptedBy 指向系统的记录，等于让报告声称
    // 「这页源图有人确认过」而事实没有。状态可以是 completed，痕迹不能伪造。
    expect(
      await exists(join(workspacePath, "stages/source/accepted.json")),
    ).toBe(false);
    const attempt = manifest.attempts.find(
      (entry) => entry.stage === "accept-source",
    );
    expect(attempt?.provider).toBe("auto-source-trust");
    expect(attempt?.assetIds).toEqual([]);
    expect(
      manifest.assets.some((asset) => asset.role === "source_acceptance"),
    ).toBe(false);
  });

  it("人工确认写下验收记录并放行下游", async () => {
    const workspacePath = await createWorkspace(GENERATED);

    const result = await runAcceptSource({
      workspacePath,
      acceptedBy: "tester",
      note: "构图可用",
    });

    expect(await exists(result.acceptedPath)).toBe(true);
    const { manifest } = await loadSlideWorkspace(workspacePath);
    expect(stageStatus(manifest, "accept-source")).toBe("completed");
    expect(() =>
      assertStageDependenciesCompleted(manifest.stages, "ocr"),
    ).not.toThrow();

    const acceptance = manifest.assets.find(
      (asset) => asset.role === "source_acceptance",
    );
    expect(acceptance).toBeDefined();
    const init = manifest.stages.find((state) => state.stage === "init");
    // 验收锚定 init 指纹：换源后 init 指纹变化，本记录随阶段 stale
    expect(
      manifest.stages.find((state) => state.stage === "accept-source")
        ?.completedInputFingerprint,
    ).toBe(init?.completedInputFingerprint);
  });

  it("对自动放行的来源拒绝人工确认，不制造多余的人工痕迹", async () => {
    const workspacePath = await createWorkspace();

    await expect(runAcceptSource({ workspacePath })).rejects.toThrow(
      "无需人工确认",
    );
  });
});

describe("run --from 的源图确认门", () => {
  it("从 ocr 起跑也先撞闸门，报「等确认」而不是「执行失败」", async () => {
    const workspacePath = await createWorkspace(GENERATED);

    // 闸门若只在循环内按序判定，这里会绕过它、由 ocr 的依赖守卫抛错，
    // 用户看到的是 gate: "error"「阶段 ocr 无法自动执行」——语义完全错位。
    const result = await runSlideRunFrom("ocr", { workspacePath });

    expect(result.gate).toBe("source");
    expect(result.stoppedAt).toBe("accept-source");
    expect(result.executed).toEqual([]);
  });

  it("确认后从 ocr 起跑不再停在闸门", async () => {
    const workspacePath = await createWorkspace(GENERATED);
    await runAcceptSource({ workspacePath });

    const result = await runSlideRunFrom("ocr", { workspacePath });

    expect(result.gate).not.toBe("source");
  });
});
