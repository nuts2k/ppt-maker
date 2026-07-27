import { FoundationError, type SlideWorkspaceManifest } from "@ppt-maker/core";
import { runAcceptClean } from "../clean/accept.js";
import { runAcceptPptx } from "../pptx/accept.js";
import { loadSlideWorkspace } from "./workspace.js";

// 最终产物确认：一次人工动作同时写入 clean 与 pptx 两条验收记录（design §3.3）。
// 两条记录的结构与单步 accept-clean / accept-pptx 完全一致，只在 note 上加统一前缀，
// 便于事后区分「逐步验收」与「最终确认统一验收」。
const NOTE_PREFIX = "经最终产物确认统一验收：";

export interface RunAcceptFinalOptions {
  readonly workspacePath: string;
  readonly acceptedBy?: string;
  readonly note?: string;
}

export interface RunAcceptFinalResult {
  readonly cleanAcceptanceId: string;
  readonly pptxAcceptanceId: string;
  readonly autoCheckSummary: string;
}

// 已 completed 的验收阶段直接复用既有记录，重复调用不追加 attempt。
// 上游变化会让该阶段转 stale，此时不满足 completed，验收会真正重做。
function completedAcceptanceId(
  manifest: SlideWorkspaceManifest,
  stage: "accept-clean" | "accept-pptx",
): string | null {
  const state = manifest.stages.find((candidate) => candidate.stage === stage);
  if (state?.status !== "completed") {
    return null;
  }
  return state.lastSuccessfulAttemptId;
}

export async function runAcceptFinal(
  options: RunAcceptFinalOptions,
): Promise<RunAcceptFinalResult> {
  const note = `${NOTE_PREFIX}${options.note ?? ""}`;
  const acceptedBy =
    options.acceptedBy === undefined ? {} : { acceptedBy: options.acceptedBy };
  const { manifest } = await loadSlideWorkspace(options.workspacePath);

  // 顺序执行且不回滚：clean 成功而 pptx 失败时停在「clean 已验收、pptx 未验收」，
  // 重试 accept-final 时 clean 侧因已 completed 被跳过，只补 pptx 侧。
  const existingClean = completedAcceptanceId(manifest, "accept-clean");
  const clean =
    existingClean === null
      ? await runAcceptClean({
          workspacePath: options.workspacePath,
          note,
          ...acceptedBy,
        })
      : { acceptanceId: existingClean, autoCheckSummary: "已验收，跳过" };

  const existingPptx = completedAcceptanceId(manifest, "accept-pptx");
  const pptx =
    existingPptx === null
      ? await runAcceptPptx({
          workspacePath: options.workspacePath,
          note,
          ...acceptedBy,
        })
      : { acceptanceId: existingPptx, autoCheckSummary: "已验收，跳过" };

  if (clean.acceptanceId === null || pptx.acceptanceId === null) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "验收阶段标记为 completed 却缺少成功尝试记录",
      {
        cleanAcceptanceId: clean.acceptanceId,
        pptxAcceptanceId: pptx.acceptanceId,
      },
    );
  }

  return {
    cleanAcceptanceId: clean.acceptanceId,
    pptxAcceptanceId: pptx.acceptanceId,
    autoCheckSummary: `clean：${clean.autoCheckSummary}；pptx：${pptx.autoCheckSummary}`,
  };
}
