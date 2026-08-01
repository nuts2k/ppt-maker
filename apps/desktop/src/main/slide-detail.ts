import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CleanAttemptRecordSchema,
  PptxCheckReportSchema,
  type SlideWorkspaceManifest,
  type TextReviewDocument,
  TextReviewDocumentSchema,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
} from "@ppt-maker/core";
import {
  RUN_STAGE_SEQUENCE,
  type RunStage,
  TRANSIENT_STAGES,
} from "../shared/stages.js";
import type {
  FinalChecks,
  SlideLastError,
  SlideStageDetail,
} from "./ipc/channels.js";

const TRANSIENT = new Set<string>(TRANSIENT_STAGES);

/**
 * 复核文档在工作区内的相对路径，必须与 CLI 的 `slide/review.ts`、
 * `slide/assist-review.ts`、`slide/validate-review.ts` 三处保持一致。
 *
 * 曾经这里漏写 `stages/` 一层，`load-review` 的 readFile 失败后被 catch 吞成 null，
 * 单页复核画布拿到 0 个文字块、侧边栏三块全空，而控制台没有任何报错——
 * 表现为「点进去什么都没有」。改动此常量前先确认 CLI 侧写入路径。
 */
export const REVIEW_RELATIVE_PATH = [
  "stages",
  "review",
  "text-blocks.json",
] as const;

/** 文件不存在（正常路径：该阶段还没跑）与其它读取失败的区分 */
function isMissingFile(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

/**
 * 读取该页复核文档；文件尚未生成时返回 null。
 *
 * **不静默吞掉非 ENOENT 的失败**：路径写错、JSON 损坏、Schema 不匹配都会打到
 * stderr，否则「点进去什么都没有」将再次无从排查（见静默失败诊断指南）。
 */
export async function loadTextReviewDocument(
  absWorkspacePath: string,
): Promise<TextReviewDocument | null> {
  const reviewPath = join(absWorkspacePath, ...REVIEW_RELATIVE_PATH);
  let raw: string;
  try {
    raw = await readFile(reviewPath, "utf-8");
  } catch (error) {
    if (!isMissingFile(error)) {
      console.error("[slide-detail] 复核文档读取失败", reviewPath, error);
    }
    return null;
  }
  try {
    return TextReviewDocumentSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.error("[slide-detail] 复核文档解析失败", reviewPath, error);
    return null;
  }
}

/**
 * 仍待人工复核的版式目标文字块数。
 *
 * 判据与 CLI 的文本复核门（`slide/run-from.ts` 的 `countPendingReviewBlocks`）
 * 逐字一致：`layout_text` 且 `reviewStatus === "unreviewed"`。两处若漂移，
 * 待办队列会把 CLI 根本不会停的页列成「需文本复核」。
 */
export function countPendingTextReview(document: TextReviewDocument): number {
  return document.blocks.filter(
    (block) =>
      block.classification === "layout_text" &&
      block.reviewStatus === "unreviewed",
  ).length;
}

/** 读盘版：复核文档缺失或损坏时为 0（此时该页本就不该进「需文本复核」分组） */
export async function readPendingTextReview(
  absWorkspacePath: string,
): Promise<number> {
  const document = await loadTextReviewDocument(absWorkspacePath);
  return document === null ? 0 : countPendingTextReview(document);
}

/**
 * 某阶段**当前那次成功尝试**产出的资产。
 *
 * 必须按 `lastSuccessfulAttemptId` 匹配，不能只按 role 取第一个——真实工作区里
 * clean 跑过两次，`clean_record` 有 clean-001 与 clean-002 两条，按 role 取到的是
 * 早已被取代的 clean-001，界面会展示上一版底板的检查指标。
 */
function currentSuccessAsset(
  manifest: SlideWorkspaceManifest,
  stage: string,
  role: string,
): WorkspaceAsset | undefined {
  const attemptId = manifest.stages.find(
    (state) => state.stage === stage,
  )?.lastSuccessfulAttemptId;
  if (attemptId === null || attemptId === undefined) return undefined;
  return manifest.assets.find(
    (asset) => asset.role === role && asset.attemptId === attemptId,
  );
}

/**
 * 当前源图资产。
 *
 * 换源后 `assets` 里会有多条 `source_image`（旧图刻意保留，换源历史因此可查），
 * 按 role 取第一条拿到的是**已被替换掉的旧图**——界面会在换完源之后继续显示旧图，
 * 与磁盘事实相反。唯一可信的判据是 `sourceImageAssetId`。
 */
export function currentSourceImageAsset(
  manifest: SlideWorkspaceManifest,
): WorkspaceAsset | undefined {
  return manifest.assets.find(
    (asset) => asset.id === manifest.sourceImageAssetId,
  );
}

async function readJsonAsset<T>(
  absWorkspacePath: string,
  asset: WorkspaceAsset | undefined,
  parse: (value: unknown) => T,
): Promise<T | null> {
  if (asset === undefined) return null;
  const filePath = join(absWorkspacePath, asset.path);
  try {
    return parse(JSON.parse(await readFile(filePath, "utf-8")));
  } catch (error) {
    if (!isMissingFile(error)) {
      console.error("[slide-detail] 检查记录读取失败", filePath, error);
    }
    return null;
  }
}

/**
 * 最终确认页要展示的自动检查：pptx 六项报告与 clean 的四组裸指标。
 *
 * 两者都只读既有产物、不重算；阶段未跑或记录缺失时为 null，由界面呈现「暂无」。
 * clean 侧解析整条 attempt 记录后取 `checks`，与 `clean/accept.ts` 的口径一致。
 */
export async function readFinalChecks(
  absWorkspacePath: string,
  manifest: SlideWorkspaceManifest,
): Promise<FinalChecks> {
  const [pptx, cleanRecord] = await Promise.all([
    readJsonAsset(
      absWorkspacePath,
      currentSuccessAsset(manifest, "pptx", "pptx_check"),
      (value) => PptxCheckReportSchema.parse(value),
    ),
    readJsonAsset(
      absWorkspacePath,
      currentSuccessAsset(manifest, "clean", "clean_record"),
      (value) => CleanAttemptRecordSchema.parse(value),
    ),
  ]);
  return { pptx, clean: cleanRecord === null ? null : cleanRecord.checks };
}

/** 当前 pptx 成功尝试的产物绝对路径；未生成时为 null */
export function resolvePptxArtifactPath(
  absWorkspacePath: string,
  manifest: SlideWorkspaceManifest,
): string | null {
  const asset = currentSuccessAsset(manifest, "pptx", "pptx");
  return asset === undefined ? null : join(absWorkspacePath, asset.path);
}

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

/**
 * 某阶段当前那次 attempt：优先按 `latestAttemptId` 取，取不到则退回该阶段
 * 结束时间最新的一条。返回 null 表示该阶段还没跑过。
 */
function currentAttemptOf(
  manifest: SlideWorkspaceManifest,
  stage: string,
  state: { readonly latestAttemptId: string | null },
): WorkspaceStageAttempt | null {
  if (state.latestAttemptId !== null) {
    const byId = manifest.attempts.find(
      (attempt) => attempt.id === state.latestAttemptId,
    );
    if (byId !== undefined) return byId;
  }
  let newest: WorkspaceStageAttempt | null = null;
  for (const attempt of manifest.attempts) {
    if (attempt.stage !== stage) continue;
    if (newest === null || attemptEndTime(attempt) >= attemptEndTime(newest)) {
      newest = attempt;
    }
  }
  return newest;
}

/**
 * 当前仍挡在路上的错误，供卡片与阶段轨道的错误条展示。
 *
 * 只看每个阶段**当前那次** attempt（`latestAttemptId`），而不是全部历史 attempt。
 * 后者会让「失败过、重试已成功」的阶段永远挂着一条错误：真实工作区里
 * assist-review 前三次因缺 OPENAI_API_KEY 失败、第四次成功且阶段已 completed，
 * 界面却一直显示那条 MISSING_DEPENDENCY，把已经解决的问题报成当前故障。
 *
 * `latestAttemptId` 缺失的旧 manifest 回退到该阶段结束时间最新的 attempt。
 */
export function extractLastError(
  manifest: SlideWorkspaceManifest,
): SlideLastError | null {
  let latest: WorkspaceStageAttempt | null = null;
  for (const state of manifest.stages) {
    const attempt = currentAttemptOf(manifest, state.stage, {
      latestAttemptId: state.latestAttemptId,
    });
    if (attempt === null) continue;
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
