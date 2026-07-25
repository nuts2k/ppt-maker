import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isStageReusable, type SlideStage } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { invalidateSlideStage } from "../src/slide/invalidate.js";
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

/** manifest 的指纹字段有 64 位十六进制格式校验，假数据也得满足 */
function fakeFingerprint(stage: string): string {
  return createHash("sha256").update(stage).digest("hex");
}

/** 建工作区并把指定阶段置为 completed，模拟已跑到某一步的现场 */
async function createWorkspaceWithCompleted(
  completed: readonly SlideStage[],
): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-invalidate-"));
  const workspacePath = join(parent, "slide");
  await createSlideWorkspace({
    imagePath: fixturePath(),
    workspacePath,
  });
  const workspace = await loadSlideWorkspace(workspacePath);
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    stages: workspace.manifest.stages.map((state) =>
      completed.includes(state.stage)
        ? {
            ...state,
            status: "completed" as const,
            latestAttemptId: `${state.stage}-001`,
            lastSuccessfulAttemptId: `${state.stage}-001`,
            completedInputFingerprint: fakeFingerprint(state.stage),
          }
        : state,
    ),
  });
  return workspacePath;
}

async function statusOf(
  workspacePath: string,
  stage: SlideStage,
): Promise<string | undefined> {
  const workspace = await loadSlideWorkspace(workspacePath);
  return workspace.manifest.stages.find((state) => state.stage === stage)
    ?.status;
}

describe("invalidateSlideStage", () => {
  it("把目标阶段与已完成的下游标为 stale，pending 阶段不受影响", async () => {
    const workspacePath = await createWorkspaceWithCompleted([
      "ocr",
      "review",
      "assist-review",
      "mask",
      "clean",
    ]);

    const result = await invalidateSlideStage({
      workspacePath,
      stage: "clean",
      reason: "人工要求从该阶段重跑",
    });

    expect(await statusOf(workspacePath, "clean")).toBe("stale");
    // accept-clean 及其后本就是 pending，不该被改写成 stale
    expect(await statusOf(workspacePath, "accept-clean")).toBe("pending");
    // 上游必须原样保留，否则"重跑 clean"会连带把 mask 也拖下水
    expect(await statusOf(workspacePath, "mask")).toBe("completed");
    expect(result.invalidated).toEqual(["clean"]);
  });

  it("失效后 clean 不再满足复用判据 —— 这是重跑真正生效的前提", async () => {
    // 缺陷回归：拒绝验收时输入指纹一字未变，clean 仍是 completed，于是
    // run-from 的守卫整段跳过 clean、直接滑到 accept-clean 闸门原地返回，
    // runSlideClean 内部的 isStageReusable 也会复用旧产物。界面上表现为
    // 「点重跑毫无反应」，点几次都一样。两道判断都只认 completed，
    // 因此断言必须落在"状态不再是 completed"上，不能只断言写盘成功。
    const workspacePath = await createWorkspaceWithCompleted(["clean"]);
    const before = await loadSlideWorkspace(workspacePath);
    const beforeState = before.manifest.stages.find((s) => s.stage === "clean");
    expect(beforeState).toBeDefined();
    if (beforeState === undefined) return;
    expect(isStageReusable(beforeState, fakeFingerprint("clean"))).toBe(true);

    await invalidateSlideStage({
      workspacePath,
      stage: "clean",
      reason: "人工要求从该阶段重跑",
    });

    const after = await loadSlideWorkspace(workspacePath);
    const afterState = after.manifest.stages.find((s) => s.stage === "clean");
    expect(afterState).toBeDefined();
    if (afterState === undefined) return;
    // 指纹未变，仅凭状态变化就必须拒绝复用
    expect(isStageReusable(afterState, fakeFingerprint("clean"))).toBe(false);
    expect(afterState.invalidationReason).toBe("人工要求从该阶段重跑");
    expect(afterState.invalidatedAt).not.toBeNull();
  });

  it("下游已完成的阶段一并失效", async () => {
    const workspacePath = await createWorkspaceWithCompleted([
      "mask",
      "clean",
      "accept-clean",
      "pptx",
    ]);

    const result = await invalidateSlideStage({
      workspacePath,
      stage: "clean",
      reason: "人工要求从该阶段重跑",
    });

    expect(result.invalidated).toEqual(["clean", "accept-clean", "pptx"]);
    expect(await statusOf(workspacePath, "mask")).toBe("completed");
  });

  it("失效原因为空时报错", async () => {
    const workspacePath = await createWorkspaceWithCompleted(["clean"]);
    await expect(
      invalidateSlideStage({ workspacePath, stage: "clean", reason: "  " }),
    ).rejects.toThrow(/失效原因/);
  });
});
