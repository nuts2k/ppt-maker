import { FoundationError, type SlideWorkspaceManifest } from "@ppt-maker/core";
import { runSlideMask } from "../mask/run.js";
import { runSlidePptx } from "../pptx/run.js";
import { runSlideReport } from "../report/run.js";
import { runSlideOcr } from "./ocr.js";
import { runSlideReview } from "./review.js";
import { runSlideValidateReview } from "./validate-review.js";
import { loadSlideWorkspace } from "./workspace.js";

const RUN_SEQUENCE = [
  "ocr",
  "review",
  "assist-review",
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
    | "api"
    | "manual"
    | "validation-failed"
    | "error"
    | null;
  readonly nextCommand: string | null;
  readonly message: string;
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

    try {
      if (stage === "ocr") {
        await runSlideOcr({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "review") {
        await runSlideReview({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "assist-review") {
        if (
          stageState(workspace.manifest, "assist-review")?.status !==
          "completed"
        ) {
          return {
            executed,
            stoppedAt: "assist-review",
            gate: "api",
            nextCommand: `ppt-maker slide assist-review --confirm-api ${options.workspacePath}`,
            message:
              "AI 辅助复核需显式调用 API，run 不会自动触发；完成后可继续 run --from validate-review",
          };
        }
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
