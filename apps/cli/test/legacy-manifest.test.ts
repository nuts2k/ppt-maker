import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStageDependenciesCompleted } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  createSlideWorkspace,
  loadSlideWorkspace,
  writeWorkspaceManifest,
} from "../src/slide/workspace.js";

/**
 * M5 零迁移承诺的回归测试（父任务 RK4 / 子任务 B1）。
 *
 * `accept-source` 加入 `SlideStage` 后，`SlideWorkspaceManifestSchema` 的
 * superRefine 会要求每个阶段都有状态，M3/M4 时代产出的每一个工作区都会**加载失败**。
 * 防线是加载期归一化，且它必须排在 `parse` 之前——顺序颠倒时本文件全部失败。
 */

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

/** 把新建工作区回退成 M3/M4 时代的形态：没有 source，没有 accept-source */
async function degradeToLegacy(workspacePath: string): Promise<string> {
  const manifestPath = join(workspacePath, "manifest.json");
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  delete raw.source;
  raw.stages = (raw.stages as { stage: string }[]).filter(
    (state) => state.stage !== "accept-source",
  );
  raw.attempts = (raw.attempts as { stage: string }[]).filter(
    (attempt) => attempt.stage !== "accept-source",
  );
  await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return manifestPath;
}

async function sha256Of(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function createLegacyWorkspace(): Promise<{
  readonly workspacePath: string;
  readonly manifestPath: string;
}> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-legacy-"));
  const workspacePath = join(parent, "slide-legacy");
  await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
  const manifestPath = await degradeToLegacy(workspacePath);
  return { workspacePath, manifestPath };
}

describe("旧工作区零迁移加载", () => {
  it("缺 source 的 manifest 被归一化为 imported，溯源取自既有事实", async () => {
    const { workspacePath, manifestPath } = await createLegacyWorkspace();
    const before = JSON.parse(await readFile(manifestPath, "utf8")) as {
      createdAt: string;
    };

    const loaded = await loadSlideWorkspace(workspacePath);

    expect(loaded.manifest.source.kind).toBe("imported");
    if (loaded.manifest.source.kind !== "imported") return;
    // 文件名取自 config.sourceImagePath 的 basename
    expect(loaded.manifest.source.originalFileName).toBe("source.png");
    expect(loaded.manifest.source.attemptId).toBe("init-001");
    // 用 manifest 自己的 createdAt，不用 now()——写 now 等于声称「今天导入的」
    expect(loaded.manifest.source.recordedAt).toBe(before.createdAt);
  });

  it("缺 accept-source 状态时补为 completed 并沿用 init 的指纹", async () => {
    const { workspacePath } = await createLegacyWorkspace();

    const loaded = await loadSlideWorkspace(workspacePath);
    const gate = loaded.manifest.stages.find(
      (state) => state.stage === "accept-source",
    );
    const init = loaded.manifest.stages.find((state) => state.stage === "init");

    expect(gate?.status).toBe("completed");
    expect(gate?.lastSuccessfulAttemptId).toBe(init?.lastSuccessfulAttemptId);
    expect(gate?.completedInputFingerprint).toBe(
      init?.completedInputFingerprint,
    );
    // 归一化后闸门已完成，下游 ocr 的依赖守卫不再拦截，链路可继续
    expect(() =>
      assertStageDependenciesCompleted(loaded.manifest.stages, "ocr"),
    ).not.toThrow();
  });

  it("只读加载不改动磁盘：旧工作区文件逐字节不变", async () => {
    const { workspacePath, manifestPath } = await createLegacyWorkspace();
    const before = await sha256Of(manifestPath);

    await loadSlideWorkspace(workspacePath);
    await loadSlideWorkspace(workspacePath);

    expect(await sha256Of(manifestPath)).toBe(before);
  });

  it("首次写操作时新字段自然落盘，无需独立迁移程序", async () => {
    const { workspacePath, manifestPath } = await createLegacyWorkspace();

    const loaded = await loadSlideWorkspace(workspacePath);
    await writeWorkspaceManifest(workspacePath, loaded.manifest);

    const persisted = JSON.parse(await readFile(manifestPath, "utf8")) as {
      source: { kind: string };
      stages: { stage: string }[];
    };
    expect(persisted.source.kind).toBe("imported");
    expect(
      persisted.stages.some((state) => state.stage === "accept-source"),
    ).toBe(true);
  });

  it("归一化不掩盖真实损坏：manifest 结构坏掉时仍报 schema 错误", async () => {
    const { workspacePath, manifestPath } = await createLegacyWorkspace();
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    raw.sourceImageAssetId = "asset-does-not-exist";
    await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    await expect(loadSlideWorkspace(workspacePath)).rejects.toThrow();
  });
});
