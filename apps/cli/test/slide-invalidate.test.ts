import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTO_SOURCE_TRUST_PROVIDER,
  isStageReusable,
  resolveSourceAcceptanceMode,
  type SlideSourceDraft,
  type SlideStage,
} from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { runAcceptSource } from "../src/slide/accept-source.js";
import { invalidateSlideStage } from "../src/slide/invalidate.js";
import { runSlideRunFrom } from "../src/slide/run-from.js";
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

/*
 * 缺陷回归（2026-08-02 实测）：失效波及 `accept-source` 时，非生成页会停在一道
 * **谁都解不开**的门上——`runAcceptSource` 对非生成页直接拒绝（那条拒绝是对的，
 * 否则凭空产生假的人工痕迹），而 `run --from` 停在这道门上给出的下一条命令恰恰是它，
 * 桌面端工具栏也据 `awaitingSourceConfirm` 摆出「确认源图」，按下去必然报错。
 *
 * 修法不是堵按钮：`imported` / `extracted` 的源图确认是**来源规则的结论**而非一次
 * 人工动作，失效后正确行为是按来源自动重新放行——`replaceSlideSource` 第 5 步早就
 * 这么做了，缺的只是让另一条失效路径也走这一步。
 */
describe("失效波及 accept-source 时按来源重判", () => {
  const HASH = "a".repeat(64);
  const GENERATED: SlideSourceDraft = {
    kind: "generated",
    specEntryId: "entry-001",
    specEntrySha256: HASH,
    providerId: "openai-image",
    model: "gpt-image-2",
    promptVersion: "m5-generate-v1",
    promptSha256: HASH,
    parameters: {},
  };

  async function createWithSource(
    source: SlideSourceDraft | undefined,
    completed: readonly SlideStage[],
  ): Promise<string> {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-invalidate-gate-"));
    const workspacePath = join(parent, "slide");
    await createSlideWorkspace({
      imagePath: fixturePath(),
      workspacePath,
      ...(source === undefined ? {} : { source }),
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

  it("导入页自动重新放行，下游仍然 stale", async () => {
    const workspacePath = await createWithSource(undefined, [
      "ocr",
      "review",
      "mask",
    ]);

    const result = await invalidateSlideStage({
      workspacePath,
      stage: "accept-source",
      reason: "人工要求从该阶段重跑",
    });

    // 闸门回到 completed —— 「从该阶段重跑」想要的是下游重做，不是卡在门口
    expect(await statusOf(workspacePath, "accept-source")).toBe("completed");
    expect(await statusOf(workspacePath, "ocr")).toBe("stale");
    expect(await statusOf(workspacePath, "mask")).toBe("stale");
    expect(result.invalidated).not.toContain("accept-source");
    expect(result.invalidated).toContain("ocr");
  });

  it("自动重放行只追加一条 auto-source-trust attempt，不写 accepted.json", async () => {
    const workspacePath = await createWithSource(undefined, ["ocr"]);
    await invalidateSlideStage({
      workspacePath,
      stage: "accept-source",
      reason: "人工要求从该阶段重跑",
    });

    const { manifest } = await loadSlideWorkspace(workspacePath);
    const attempts = manifest.attempts.filter(
      (attempt) => attempt.stage === "accept-source",
    );
    expect(attempts.map((attempt) => attempt.id)).toEqual([
      "accept-source-001",
      "accept-source-002",
    ]);
    // 事实只记在 attempt 的 provider 上；写一条 acceptedBy 指向系统的记录就是伪造人工痕迹
    expect(attempts.map((attempt) => attempt.provider)).toEqual([
      AUTO_SOURCE_TRUST_PROVIDER,
      AUTO_SOURCE_TRUST_PROVIDER,
    ]);
    expect(
      manifest.assets.find((asset) => asset.role === "source_acceptance"),
    ).toBeUndefined();
    expect(resolveSourceAcceptanceMode(manifest)).toBe("auto");
  });

  it("重放行后 CLI 不再把用户指向一条必然失败的命令", async () => {
    const workspacePath = await createWithSource(undefined, []);
    await invalidateSlideStage({
      workspacePath,
      stage: "accept-source",
      reason: "人工要求从该阶段重跑",
    });

    // 此前这里返回 gate: "source" 并让用户去跑 slide accept-source，而那条命令必抛错
    const result = await runSlideRunFrom("ocr", { workspacePath });
    expect(result.gate).not.toBe("source");
    await expect(runAcceptSource({ workspacePath })).rejects.toThrow(
      "无需人工确认",
    );
  });

  it("生成页不受影响：仍然停在门上等人确认", async () => {
    const workspacePath = await createWithSource(GENERATED, ["ocr"]);
    await runAcceptSource({ workspacePath, acceptedBy: "tester" });
    expect(await statusOf(workspacePath, "accept-source")).toBe("completed");

    const result = await invalidateSlideStage({
      workspacePath,
      stage: "accept-source",
      reason: "人工要求重新审图",
    });

    expect(result.invalidated).toContain("accept-source");
    expect(await statusOf(workspacePath, "accept-source")).toBe("stale");
    // 而且这条门是解得开的：人工确认对生成页本来就成立
    await runAcceptSource({ workspacePath, acceptedBy: "tester" });
    expect(await statusOf(workspacePath, "accept-source")).toBe("completed");
  });

  it("init 自身未完成时不重放行：源图本身就在存疑状态", async () => {
    const workspacePath = await createWithSource(undefined, ["ocr"]);
    await invalidateSlideStage({
      workspacePath,
      stage: "init",
      reason: "人工要求从头重来",
    });

    expect(await statusOf(workspacePath, "init")).toBe("stale");
    expect(await statusOf(workspacePath, "accept-source")).toBe("stale");
  });
});
