import {
  FoundationError,
  type SlideStage,
  type SlideWorkspaceManifest,
  type WorkspaceAsset,
} from "@ppt-maker/core";
import { runSlideMask } from "../mask/run.js";
import { runSlidePptx } from "../pptx/run.js";
import { runSlideReport } from "../report/run.js";
import { runSlideOcr } from "./ocr.js";
import { computeReviewInputFingerprint, runSlideReview } from "./review.js";
import { runSlideValidateReview } from "./validate-review.js";
import { loadSlideWorkspace } from "./workspace.js";

// run 编排的主局部路径；review 始终在 mask 之前，保证 analyze 产出经复核再被消费。
const RUN_SEQUENCE = [
  "ocr",
  "review",
  "validate-review",
  "mask",
  "clean",
  "accept-clean",
  "pptx",
  "accept-pptx",
  "report",
] as const;

type RunStage = (typeof RUN_SEQUENCE)[number];

export interface RunFromOptions {
  readonly workspacePath: string;
}

export interface RunFromResult {
  readonly executed: string[];
  readonly stoppedAt: string | null;
  readonly gate:
    | "human-edit"
    | "upload"
    | "manual"
    | "validation-failed"
    | "analyze-review"
    | "error"
    | null;
  readonly nextCommand: string | null;
  readonly message: string;
}

function lastSuccessfulAsset(
  manifest: SlideWorkspaceManifest,
  stage: SlideStage,
  role: WorkspaceAsset["role"],
): WorkspaceAsset | null {
  const state = manifest.stages.find((candidate) => candidate.stage === stage);
  if (state === undefined || state.lastSuccessfulAttemptId === null) {
    return null;
  }
  return (
    manifest.assets.find(
      (asset) =>
        asset.attemptId === state.lastSuccessfulAttemptId &&
        asset.role === role,
    ) ?? null
  );
}

// review 是否已并入当前 analyze 产出（备忘：analyze 首跑后、mask 消费前须先重跑 review）。
function reviewFreshWrtAnalyze(manifest: SlideWorkspaceManifest): boolean {
  const analyzeState = manifest.stages.find(
    (state) => state.stage === "analyze",
  );
  if (analyzeState?.status !== "completed") {
    return true;
  }
  const reviewState = manifest.stages.find((state) => state.stage === "review");
  if (
    reviewState?.status !== "completed" ||
    reviewState.completedInputFingerprint === null
  ) {
    return false;
  }
  const ocrAsset = lastSuccessfulAsset(manifest, "ocr", "ocr_result");
  const analysisAsset = lastSuccessfulAsset(
    manifest,
    "analyze",
    "analysis_result",
  );
  const referenceAsset =
    manifest.referenceTextAssetId === null
      ? null
      : (manifest.assets.find(
          (asset) => asset.id === manifest.referenceTextAssetId,
        ) ?? null);
  const expected = computeReviewInputFingerprint({
    ocrSha256: ocrAsset?.sha256 ?? "no-ocr",
    analysisSha256: analysisAsset?.sha256 ?? null,
    referenceSha256: referenceAsset?.sha256 ?? null,
  });
  return reviewState.completedInputFingerprint === expected;
}

function stageState(manifest: SlideWorkspaceManifest, stage: string) {
  return manifest.stages.find((state) => state.stage === stage);
}

export async function runSlideRunFrom(
  from: string,
  options: RunFromOptions,
): Promise<RunFromResult> {
  const startIndex = RUN_SEQUENCE.indexOf(from as RunStage);
  if (startIndex === -1) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      `run --from 不支持的阶段：${from}`,
      { supported: RUN_SEQUENCE },
    );
  }

  const executed: string[] = [];
  for (let i = startIndex; i < RUN_SEQUENCE.length; i += 1) {
    const stage = RUN_SEQUENCE[i];
    if (stage === undefined) {
      continue;
    }
    const workspace = await loadSlideWorkspace(options.workspacePath);

    // 消费复核结果的阶段前，确保 review 已并入 analyze 产出。
    if (
      (stage === "validate-review" || stage === "mask") &&
      !reviewFreshWrtAnalyze(workspace.manifest)
    ) {
      return {
        executed,
        stoppedAt: "review",
        gate: "analyze-review",
        nextCommand: `ppt-maker slide run --from review ${options.workspacePath}`,
        message:
          "analyze 产出尚未并入复核，请先 run --from review 并人工复核后继续",
      };
    }

    try {
      if (stage === "ocr") {
        await runSlideOcr({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "review") {
        await runSlideReview({ workspacePath: options.workspacePath });
        executed.push(stage);
        return {
          executed,
          stoppedAt: "review",
          gate: "human-edit",
          nextCommand: `ppt-maker slide validate-review ${options.workspacePath}`,
          message:
            "review 已生成候选，请人工编辑 stages/review/text-blocks.json（设置分类、mask 参与、复核状态）后运行 validate-review 或 run --from validate-review",
        };
      } else if (stage === "validate-review") {
        const { report } = await runSlideValidateReview({
          workspacePath: options.workspacePath,
        });
        executed.push(stage);
        if (report.status !== "passed") {
          return {
            executed,
            stoppedAt: "validate-review",
            gate: "validation-failed",
            nextCommand: `ppt-maker slide validate-review ${options.workspacePath}`,
            message: `复核校验未通过（错误 ${report.summary.errors}），请修复 text-blocks.json 后重试`,
          };
        }
      } else if (stage === "mask") {
        await runSlideMask({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "pptx") {
        await runSlidePptx({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "report") {
        await runSlideReport({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "clean") {
        // 上传门：已完成则透传，否则停止提示显式上传。
        if (stageState(workspace.manifest, "clean")?.status !== "completed") {
          return {
            executed,
            stoppedAt: "clean",
            gate: "upload",
            nextCommand: `ppt-maker slide clean --confirm-upload ${options.workspacePath}`,
            message: "clean plate 需显式上传源图与 mask，run 不会自动上传",
          };
        }
      } else if (stage === "accept-clean" || stage === "accept-pptx") {
        // 人工门：已完成则透传，否则停止提示人工接受。
        if (stageState(workspace.manifest, stage)?.status !== "completed") {
          const command =
            stage === "accept-clean"
              ? `ppt-maker slide accept-clean ${options.workspacePath}`
              : `ppt-maker slide accept-pptx ${options.workspacePath}`;
          return {
            executed,
            stoppedAt: stage,
            gate: "manual",
            nextCommand: command,
            message:
              stage === "accept-clean"
                ? "请人工核对 clean plate 后运行 accept-clean"
                : "请在 PowerPoint for Mac 检查后运行 accept-pptx",
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        executed,
        stoppedAt: stage,
        gate: "error",
        nextCommand: null,
        message: `阶段 ${stage} 无法自动执行：${message}`,
      };
    }
  }

  return {
    executed,
    stoppedAt: null,
    gate: null,
    nextCommand: null,
    message: "已执行到 report，流水线完成",
  };
}
