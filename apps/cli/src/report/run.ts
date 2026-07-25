import { readFile } from "node:fs/promises";
import {
  type ArtifactAcceptance,
  ArtifactAcceptanceSchema,
  type CleanAttemptRecord,
  CleanAttemptRecordSchema,
  FoundationError,
  type MaskRecord,
  MaskRecordSchema,
  type PptxCheckReport,
  PptxCheckReportSchema,
  type ProviderCallRecord,
  ProviderCallRecordSchema,
  SCHEMA_VERSION,
  type SlideReport,
  SlideReportSchema,
  type SlideWorkspaceManifest,
  TextReviewDocumentSchema,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import {
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256Values,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "../slide/workspace.js";

const REVIEW_OUTPUT_PATH = "stages/review/text-blocks.json";
const REPORT_PATH = "stages/report/report.json";
const REPORT_ASSET_ID = "asset-report";
/** 报告结构版本，随 SlideReport 字段变更递增；落入 attempt.providerVersion */
const REPORT_VERSION = "m1-report-v1";

function replaceStageState(
  states: readonly WorkspaceStageState[],
  replacement: WorkspaceStageState,
): WorkspaceStageState[] {
  return states.map((state) =>
    state.stage === replacement.stage ? replacement : state,
  );
}

export interface RunSlideReportOptions {
  readonly workspacePath: string;
}

export interface RunSlideReportResult {
  readonly reportPath: string;
  readonly report: SlideReport;
}

function stageStatus(manifest: SlideWorkspaceManifest, stage: string): string {
  return (
    manifest.stages.find((state) => state.stage === stage)?.status ?? "missing"
  );
}

async function readJsonAsset<T>(
  workspacePath: string,
  asset: WorkspaceAsset | undefined,
  parse: (value: unknown) => T,
): Promise<T | null> {
  if (asset === undefined) {
    return null;
  }
  return parse(
    JSON.parse(
      await readFile(resolveWorkspacePath(workspacePath, asset.path), "utf8"),
    ),
  );
}

export async function runSlideReport(
  options: RunSlideReportOptions,
): Promise<RunSlideReportResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const manifest = workspace.manifest;

  const review = TextReviewDocumentSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH),
        "utf8",
      ).catch(() => "null"),
    ) ?? {
      schemaVersion: SCHEMA_VERSION,
      slideId: manifest.slideId,
      image: { width: 1, height: 1 },
      generatedAt: manifest.createdAt,
      reviewStartedAt: null,
      blocks: [],
      unmatchedReferenceCandidates: [],
    },
  );

  const ocrAsset = manifest.assets.find((asset) => asset.role === "ocr_result");
  const ocr = await readJsonAsset(workspace.path, ocrAsset, (value) =>
    z_ocr(value),
  );
  const maskRecord = await readJsonAsset<MaskRecord>(
    workspace.path,
    manifest.assets.find((asset) => asset.role === "mask_record"),
    (value) => MaskRecordSchema.parse(value),
  );
  const cleanRecord = await readJsonAsset<CleanAttemptRecord>(
    workspace.path,
    manifest.assets.find((asset) => asset.role === "clean_record"),
    (value) => CleanAttemptRecordSchema.parse(value),
  );
  const cleanAcceptance = await readJsonAsset<ArtifactAcceptance>(
    workspace.path,
    manifest.assets.find((asset) => asset.role === "clean_acceptance"),
    (value) => ArtifactAcceptanceSchema.parse(value),
  );
  const pptxCheck = await readJsonAsset<PptxCheckReport>(
    workspace.path,
    manifest.assets.find((asset) => asset.role === "pptx_check"),
    (value) => PptxCheckReportSchema.parse(value),
  );
  const pptxAcceptance = await readJsonAsset<ArtifactAcceptance>(
    workspace.path,
    manifest.assets.find((asset) => asset.role === "pptx_acceptance"),
    (value) => ArtifactAcceptanceSchema.parse(value),
  );

  /*
   * 本阶段的落库状态。
   *
   * 此前这里只写 assets、完全没碰 stages/attempts，report 于是永远停在 pending：
   * 每次 run 都从 report 起跑、每次都成功、每次都不改状态，界面上就是「点了没反应」，
   * 用户只能反复点。补齐后与其余阶段一致。
   *
   * report 是毫秒级的纯本地汇总，没有中断窗口值得记录，因此直接写 completed，
   * 不走「先 running 再 replace」的两段式——那会为一次瞬时操作多写一遍盘。
   */
  const startedAt = new Date().toISOString();
  const attemptNumber =
    manifest.attempts.filter((attempt) => attempt.stage === "report").length +
    1;
  const attemptId = `report-${String(attemptNumber).padStart(3, "0")}`;
  // report 无外部产物可做指纹，输入即上游各阶段的完成态
  const inputFingerprint = sha256Values(
    manifest.stages
      .filter((state) => state.stage !== "report")
      .map(
        (state) =>
          `${state.stage}:${state.status}:${state.lastSuccessfulAttemptId ?? ""}`,
      ),
  );
  const previousState = manifest.stages.find(
    (state) => state.stage === "report",
  );
  if (previousState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 report 阶段状态",
    );
  }

  const providerCalls: SlideReport["providerCalls"] = [];
  for (const asset of manifest.assets.filter(
    (candidate) => candidate.role === "provider_record",
  )) {
    const record = await readJsonAsset<ProviderCallRecord>(
      workspace.path,
      asset,
      (value) => ProviderCallRecordSchema.parse(value),
    );
    if (record !== null && record.error === null) {
      providerCalls.push({
        stage: record.stage,
        model: record.model,
        requestId: record.requestId,
        durationMs: record.durationMs,
        usage: record.usage,
      });
    }
  }

  const layoutText = review.blocks.filter(
    (block) => block.classification === "layout_text",
  );
  const reviewedLayoutText = layoutText.filter(
    (block) => block.reviewStatus !== "unreviewed",
  );
  const objectSymbol = review.blocks.filter(
    (block) => block.classification === "object_integrated_symbol",
  ).length;
  const uncertain = review.blocks.filter(
    (block) => block.classification === "uncertain",
  ).length;

  const cleanAcceptStale =
    stageStatus(manifest, "accept-clean") !== "completed";
  const pptxAcceptStale = stageStatus(manifest, "accept-pptx") !== "completed";

  const pptxAcceptedAt = pptxAcceptance?.acceptedAt ?? null;
  const reviewStartedAt = review.reviewStartedAt;
  const reviewToPptxAcceptMs =
    reviewStartedAt !== null && pptxAcceptedAt !== null && !pptxAcceptStale
      ? Math.max(0, Date.parse(pptxAcceptedAt) - Date.parse(reviewStartedAt))
      : null;

  const overallComplete =
    stageStatus(manifest, "accept-pptx") === "completed" &&
    stageStatus(manifest, "accept-clean") === "completed" &&
    pptxCheck?.status === "passed" &&
    layoutText.length > 0 &&
    reviewedLayoutText.length === layoutText.length;

  const completedState: WorkspaceStageState = {
    ...previousState,
    status: "completed",
    latestAttemptId: attemptId,
    lastSuccessfulAttemptId: attemptId,
    completedInputFingerprint: inputFingerprint,
    invalidatedAt: null,
    invalidationReason: null,
  };
  const nextStages = replaceStageState(manifest.stages, completedState);

  const report: SlideReport = SlideReportSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    slideId: manifest.slideId,
    generatedAt: new Date().toISOString(),
    overallStatus: overallComplete ? "complete" : "incomplete",
    // 用落库后的状态，否则报告会把自己记成 pending
    stages: nextStages.map((state) => ({
      stage: state.stage,
      status: state.status,
    })),
    discovery: {
      ocrBlockCount: ocr?.blocks.length ?? 0,
      reviewBlockCount: review.blocks.length,
      reviewedLayoutTextCount: reviewedLayoutText.length,
      unreviewedLayoutTextCount: layoutText.length - reviewedLayoutText.length,
    },
    classification: {
      layoutText: layoutText.length,
      objectIntegratedSymbol: objectSymbol,
      uncertain,
    },
    mask:
      maskRecord === null
        ? null
        : {
            maskedBlockCount: maskRecord.totals.maskedBlockCount,
            maskedPixels: maskRecord.totals.maskedPixels,
          },
    autoChecks: {
      cleanPlate: cleanRecord?.checks ?? null,
      pptx:
        pptxCheck === null
          ? null
          : {
              status: pptxCheck.status,
              checks: pptxCheck.checks.map((check) => ({
                id: check.id,
                status: check.status,
                message: check.message,
              })),
            },
    },
    manualAcceptance: {
      cleanPlate:
        cleanAcceptance === null
          ? null
          : {
              acceptedBy: cleanAcceptance.acceptedBy,
              acceptedAt: cleanAcceptance.acceptedAt,
              stale: cleanAcceptStale,
            },
      pptx:
        pptxAcceptance === null
          ? null
          : {
              acceptedBy: pptxAcceptance.acceptedBy,
              acceptedAt: pptxAcceptance.acceptedAt,
              stale: pptxAcceptStale,
            },
    },
    providerCalls,
    manualReview: {
      reviewStartedAt,
      cleanAcceptedAt: cleanAcceptance?.acceptedAt ?? null,
      pptxAcceptedAt,
      reviewToPptxAcceptMs,
    },
  });

  const reportPath = resolveWorkspacePath(workspace.path, REPORT_PATH);
  await writeJsonAtomic(reportPath, report);
  const asset = await createWorkspaceAsset(reportPath, {
    schemaVersion: SCHEMA_VERSION,
    id: REPORT_ASSET_ID,
    path: REPORT_PATH,
    role: "report",
    createdAt: report.generatedAt,
    producedBy: "report",
    attemptId,
    image: null,
  });
  const completedAttempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "report",
    number: attemptNumber,
    status: "completed",
    inputFingerprint,
    startedAt,
    endedAt: report.generatedAt,
    provider: "ppt-maker-cli",
    providerVersion: REPORT_VERSION,
    assetIds: [asset.id],
    error: null,
  };
  await writeWorkspaceManifest(workspace.path, {
    ...manifest,
    updatedAt: report.generatedAt,
    assets: [
      ...manifest.assets.filter(
        (candidate) => candidate.id !== REPORT_ASSET_ID,
      ),
      asset,
    ],
    stages: nextStages,
    attempts: [...manifest.attempts, completedAttempt],
  });

  return { reportPath, report };
}

function z_ocr(value: unknown): { blocks: unknown[] } {
  if (
    value !== null &&
    typeof value === "object" &&
    "blocks" in value &&
    Array.isArray((value as { blocks: unknown }).blocks)
  ) {
    return { blocks: (value as { blocks: unknown[] }).blocks };
  }
  throw new FoundationError("INVALID_WORKSPACE", "OCR 产物结构无效");
}

export function formatSlideReport(report: SlideReport): string {
  const lines: string[] = [];
  lines.push(`页面 ${report.slideId} 报告（${report.overallStatus}）`);
  lines.push(
    `阶段：${report.stages.map((s) => `${s.stage}=${s.status}`).join(" ")}`,
  );
  lines.push(
    `内容：OCR ${report.discovery.ocrBlockCount} 块，复核 ${report.discovery.reviewBlockCount} 块，版式已复核 ${report.discovery.reviewedLayoutTextCount}/${report.discovery.reviewedLayoutTextCount + report.discovery.unreviewedLayoutTextCount}`,
  );
  lines.push(
    `分类：版式 ${report.classification.layoutText}，对象内符号 ${report.classification.objectIntegratedSymbol}，不确定 ${report.classification.uncertain}`,
  );
  lines.push(
    report.mask === null
      ? "mask：未生成"
      : `mask：${report.mask.maskedBlockCount} 块，${report.mask.maskedPixels} 像素`,
  );
  lines.push("— 自动检查 —");
  lines.push(
    report.autoChecks.cleanPlate === null
      ? "clean plate 自动检查：未运行"
      : `clean plate 自动检查：残留 ${report.autoChecks.cleanPlate.textResidue.residualForegroundPixels} 像素，mask 外改动率 ${report.autoChecks.cleanPlate.outsideMaskDiff.changedRatio.toFixed(4)}`,
  );
  lines.push(
    report.autoChecks.pptx === null
      ? "PPTX 自动检查：未运行"
      : `PPTX 自动检查：${report.autoChecks.pptx.status}（${report.autoChecks.pptx.checks.filter((c) => c.status === "failed").length} 项失败）`,
  );
  lines.push("— 人工接受 —");
  lines.push(
    report.manualAcceptance.cleanPlate === null
      ? "clean plate：未接受"
      : `clean plate：${report.manualAcceptance.cleanPlate.acceptedBy} 接受${report.manualAcceptance.cleanPlate.stale ? "（已 stale）" : ""}`,
  );
  lines.push(
    report.manualAcceptance.pptx === null
      ? "PPTX：未接受"
      : `PPTX：${report.manualAcceptance.pptx.acceptedBy} 接受${report.manualAcceptance.pptx.stale ? "（已 stale）" : ""}`,
  );
  lines.push(
    report.manualReview.reviewToPptxAcceptMs === null
      ? "人工复核耗时：未完成"
      : `人工复核耗时：${Math.round(report.manualReview.reviewToPptxAcceptMs / 1000)} 秒`,
  );
  return lines.join("\n");
}
