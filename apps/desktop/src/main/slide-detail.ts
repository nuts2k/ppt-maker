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
 * 断点续跑起点：执行序列中第一个未完成的阶段。
 *
 * 无持久化状态的阶段不作为判据（否则每轮都会从 validate-review 重来）。
 * 全部完成时返回 null，调用方据此把该页排除出批量队列。
 */
export function computeResumeStage(
  manifest: SlideWorkspaceManifest,
): RunStage | null {
  for (const stage of RUN_STAGE_SEQUENCE) {
    if (TRANSIENT.has(stage)) continue;
    if (manifestStatus(manifest, stage) !== "completed") {
      return stage;
    }
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
