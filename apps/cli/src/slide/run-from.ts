import { readFile } from "node:fs/promises";
import {
  FoundationError,
  type SlideWorkspaceManifest,
  TextReviewDocumentSchema,
} from "@ppt-maker/core";
import { runSlideClean } from "../clean/run.js";
import { runSlideMask } from "../mask/run.js";
import { runSlidePptx } from "../pptx/run.js";
import { runSlideReport } from "../report/run.js";
import { runAssistReview } from "./assist-review.js";
import { runSlideOcr } from "./ocr.js";
import { runSlideReview } from "./review.js";
import { runSlideValidateReview } from "./validate-review.js";
import { loadSlideWorkspace, resolveWorkspacePath } from "./workspace.js";

const REVIEW_PATH = "stages/review/text-blocks.json";

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
  readonly confirmApi?: boolean;
  readonly confirmUpload?: boolean;
  readonly onStageStart?: (stage: string) => void;
  readonly onStageComplete?: (stage: string) => void;
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

// 统计仍待人工复核的版式目标文字数量，供 mask 前的文本复核门判定。
async function countPendingReviewBlocks(
  workspacePath: string,
): Promise<number> {
  const document = TextReviewDocumentSchema.parse(
    JSON.parse(
      await readFile(resolveWorkspacePath(workspacePath, REVIEW_PATH), "utf8"),
    ),
  );
  return document.blocks.filter(
    (block) =>
      block.classification === "layout_text" &&
      block.reviewStatus === "unreviewed",
  ).length;
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
    options.onStageStart?.(stage);

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
          if (options.confirmApi === true) {
            await runAssistReview({
              workspacePath: options.workspacePath,
              confirmApi: true,
            });
            executed.push("assist-review");
          } else {
            return {
              executed,
              stoppedAt: "assist-review",
              gate: "api",
              nextCommand: `ppt-maker slide assist-review --confirm-api ${options.workspacePath}`,
              message:
                "AI 辅助复核需显式调用 API，run 不会自动触发；完成后可继续 run --from validate-review",
            };
          }
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
        // 文本复核门：mask 会把版式文字从底板上抹掉，抹之前必须由人确认文字内容。
        // stoppedAt 取 "review" 而非 "mask"——语义是回到 review 产物做人工复核，
        // 待办队列与 rerunFrom 都按 stoppedAt 定位界面（design §3.1）。
        const pending = await countPendingReviewBlocks(options.workspacePath);
        if (pending > 0) {
          return {
            executed,
            stoppedAt: "review",
            gate: "human-edit",
            nextCommand: null,
            message: `有 ${pending} 个版式目标文字待人工复核`,
          };
        }
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
          if (options.confirmUpload === true) {
            await runSlideClean({
              workspacePath: options.workspacePath,
              confirmUpload: true,
            });
            executed.push("clean");
          } else {
            return {
              executed,
              stoppedAt: "clean",
              gate: "upload",
              nextCommand: `ppt-maker slide clean --confirm-upload ${options.workspacePath}`,
              message: "clean plate 需显式上传源图与 mask，run 不会自动上传",
            };
          }
        }
      } else if (stage === "accept-clean") {
        // clean plate 不再单独设停点：底板质量由最终产物确认时连同 PPTX 一起判断
        // （design §3.2）。此处直接跳过，也不标 completed——accept-final 才写记录。
      } else if (stage === "accept-pptx") {
        if (stageState(workspace.manifest, stage)?.status !== "completed") {
          return {
            executed,
            stoppedAt: stage,
            gate: "manual",
            nextCommand: `ppt-maker slide accept-final ${options.workspacePath}`,
            message:
              "请核对最终产物（合成预览或 PowerPoint for Mac）后运行 accept-final 一次性验收 clean 与 PPTX",
          };
        }
      }
      if (executed[executed.length - 1] === stage) {
        options.onStageComplete?.(stage);
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
