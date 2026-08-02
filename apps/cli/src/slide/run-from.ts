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
  "accept-source",
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
    | "source"
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

  /*
   * 源图确认门（D6）放在循环外，对**任何** --from 起点都先过一遍。
   *
   * generated 页必须由人确认源图才继续；imported / extracted 在建立工作区时已自动放行。
   * 若只靠循环内的顺序判定，`run --from ocr` 会绕过它、改由 ocr 的依赖守卫抛错，
   * 用户看到的是「阶段 ocr 无法自动执行」——把「等一个人来确认」误报成「执行失败」。
   * 不在这里判断来源：状态本身就是来源规则的结论，重复判断只会让两处口径漂移。
   */
  const gateCheck = await loadSlideWorkspace(options.workspacePath);
  if (stageState(gateCheck.manifest, "accept-source")?.status !== "completed") {
    return {
      executed,
      stoppedAt: "accept-source",
      gate: "source",
      nextCommand: `ppt-maker slide accept-source ${options.workspacePath}`,
      message: "请确认这一页的源图可用，之后链路才会继续",
    };
  }

  for (let i = startIndex; i < RUN_SEQUENCE.length; i += 1) {
    const stage = RUN_SEQUENCE[i];
    if (stage === undefined) {
      continue;
    }
    const workspace = await loadSlideWorkspace(options.workspacePath);
    options.onStageStart?.(stage);

    try {
      if (stage === "accept-source") {
        // 已在循环外统一把关（见 runSlideRunFrom 开头），此处只占位保持序列完整
      } else if (stage === "ocr") {
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
        const { report, previousRulesVersion } = await runSlideValidateReview({
          workspacePath: options.workspacePath,
        });
        executed.push(stage);
        if (report.status !== "passed") {
          // 规则升级导致的失败要说清楚是规则变了：2026-07-25 之前建的 deck 会撞上
          // v2 新增的 LAYOUT_TEXT_MUST_BE_MASKED，失败信息本身很响亮，但读起来
          // 像是「你把文件改坏了」，而实际上这份文档产出时那条规则还不存在。
          const ruleShift =
            previousRulesVersion === null
              ? ""
              : `；该文档上一次按规则 ${previousRulesVersion} 校验，现为 ${report.rulesVersion}，本次失败可能来自新增规则`;
          return {
            executed,
            stoppedAt: "validate-review",
            gate: "validation-failed",
            nextCommand: `ppt-maker slide validate-review ${options.workspacePath}`,
            message: `复核校验未通过（错误 ${report.summary.errors}），请修复 text-blocks.json 后重试${ruleShift}`,
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
        // 与 assist-review / clean / accept-pptx 同形的 completed 守卫。
        //
        // 编排层的跳过判据由《跨层契约》〈阶段落库与强制重跑〉写死为
        // `status !== "completed"`，而 report 此前是唯一漏掉它、且函数内部也**没有**
        // 指纹复用的阶段：一个跑完的 deck 每 run 一次就重写一遍 report.json（新
        // generatedAt）并追加一条 attempt，11 页的目录 shasum 全变（2026-08-02 走查
        // 实证，attempts 里已累积 9 条 report）。后果不止是噪声——「已完成页零变化」
        // 这条不变量被打穿，且「report 有新 attempt」不再能说明这一轮真做了事。
        //
        // 显式的 `slide report` 命令不受影响：它直接调 runSlideReport，仍然递增
        // attempt。「重跑一次报告」与「编排跑到这一步」是两条路径，只有后者要幂等。
        if (stageState(workspace.manifest, "report")?.status !== "completed") {
          await runSlideReport({ workspacePath: options.workspacePath });
          executed.push(stage);
        }
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
