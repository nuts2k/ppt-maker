import type {
  SlideWorkspaceManifest,
  WorkspaceStageAttempt,
} from "@ppt-maker/core";
import {
  RUN_STAGE_SEQUENCE,
  type RunStage,
  TRANSIENT_STAGES,
} from "../shared/stages.js";
import type { SlideLastError, SlideStageDetail } from "./ipc/channels.js";

const TRANSIENT = new Set<string>(TRANSIENT_STAGES);

function manifestStatus(
  manifest: SlideWorkspaceManifest,
  stage: string,
): SlideStageDetail["status"] | undefined {
  return manifest.stages.find((state) => state.stage === stage)?.status;
}

/**
 * 输出执行序列 10 个阶段的展示状态。
 *
 * `validate-review` 在 manifest 中无持久化记录：只要下游 `mask` 已完成，
 * 说明校验必然通过过，标记 completed；否则维持 pending。重启后据此恢复轨道。
 */
export function deriveStageDetails(
  manifest: SlideWorkspaceManifest,
): SlideStageDetail[] {
  return RUN_STAGE_SEQUENCE.map((stage) => {
    if (TRANSIENT.has(stage)) {
      const downstreamDone = manifestStatus(manifest, "mask") === "completed";
      return {
        stage,
        status: downstreamDone ? "completed" : "pending",
      } satisfies SlideStageDetail;
    }
    return {
      stage,
      status: manifestStatus(manifest, stage) ?? "pending",
    } satisfies SlideStageDetail;
  });
}

/**
 * 断点续跑起点：执行序列中第一个未完成的阶段，**回退到它前面最近的瞬态阶段**。
 *
 * 判据只看有持久化状态的阶段——瞬态阶段（`validate-review`）不写 manifest，
 * 拿它当判据的话永远不是 completed，每页每轮都会被判成「从头开始」。
 *
 * 但起点不能直接跳过瞬态阶段，否则形成死锁：用户保存复核后
 * `text-blocks.json` 的 sha 变了，mask 拒绝执行并要求「重新运行 validate-review」，
 * 而续跑起点恒为 mask，永远不会回头校验——界面上表现为「点运行此页毫无反应」，
 * 点多少次都一样。回退是安全的：validate-review 是纯离线、幂等的毫秒级校验。
 *
 * 全部完成时返回 null，调用方据此把该页排除出批量队列。
 */
export function computeResumeStage(
  manifest: SlideWorkspaceManifest,
): RunStage | null {
  let pendingTransient: RunStage | null = null;
  for (const stage of RUN_STAGE_SEQUENCE) {
    if (TRANSIENT.has(stage)) {
      // 记住它，等下游出现未完成阶段时作为回退起点
      pendingTransient ??= stage;
      continue;
    }
    if (manifestStatus(manifest, stage) !== "completed") {
      return pendingTransient ?? stage;
    }
    // 该阶段已完成，说明它前面的瞬态阶段当时也通过了，不必再回退到那里
    pendingTransient = null;
  }
  return null;
}

function attemptEndTime(attempt: WorkspaceStageAttempt): number {
  return attempt.endedAt === null ? 0 : Date.parse(attempt.endedAt);
}

/** 最近一次失败的 attempt（按结束时间取最新），供卡片错误条展示 */
export function extractLastError(
  manifest: SlideWorkspaceManifest,
): SlideLastError | null {
  let latest: WorkspaceStageAttempt | null = null;
  for (const attempt of manifest.attempts) {
    if (attempt.status !== "failed" || attempt.error === null) continue;
    if (latest === null || attemptEndTime(attempt) >= attemptEndTime(latest)) {
      latest = attempt;
    }
  }
  if (latest === null || latest.error === null) return null;
  return {
    stage: latest.stage,
    code: latest.error.code,
    message: latest.error.message,
    at: latest.endedAt ?? latest.startedAt,
  };
}

/** 各阶段最近一次成功执行的耗时（毫秒） */
export function computeStageDurations(
  manifest: SlideWorkspaceManifest,
): Record<string, number> {
  const durations: Record<string, number> = {};
  const latestAt: Record<string, number> = {};

  for (const attempt of manifest.attempts) {
    if (attempt.status !== "completed" || attempt.endedAt === null) continue;
    const ended = Date.parse(attempt.endedAt);
    const started = Date.parse(attempt.startedAt);
    if (Number.isNaN(ended) || Number.isNaN(started)) continue;
    if ((latestAt[attempt.stage] ?? -1) > ended) continue;
    latestAt[attempt.stage] = ended;
    durations[attempt.stage] = Math.max(0, ended - started);
  }

  return durations;
}
