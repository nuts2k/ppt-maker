import { SCHEMA_VERSION } from "./constants.js";
import { FoundationError } from "./errors.js";
import {
  type SlideStage,
  SlideStageSchema,
  type WorkspaceStageState,
} from "./workspace-contracts.js";

export const SLIDE_STAGE_ORDER = SlideStageSchema.options;

const STAGE_DEPENDENCIES: Readonly<Record<SlideStage, readonly SlideStage[]>> =
  {
    init: [],
    ocr: ["init"],
    review: ["ocr"],
    "assist-review": ["review"],
    mask: ["assist-review"],
    clean: ["mask"],
    "accept-clean": ["clean"],
    pptx: ["accept-clean"],
    "accept-pptx": ["pptx"],
    report: ["accept-pptx"],
  };

export function getStageDependencies(stage: SlideStage): readonly SlideStage[] {
  return STAGE_DEPENDENCIES[stage];
}

export function getDownstreamStages(stage: SlideStage): readonly SlideStage[] {
  const downstream = new Set<SlideStage>();
  const queue: SlideStage[] = [stage];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const candidate of SLIDE_STAGE_ORDER) {
      if (
        !downstream.has(candidate) &&
        STAGE_DEPENDENCIES[candidate].includes(current)
      ) {
        downstream.add(candidate);
        queue.push(candidate);
      }
    }
  }

  return SLIDE_STAGE_ORDER.filter((candidate) => downstream.has(candidate));
}

export function createInitialStageStates(
  initAttemptId: string,
  initInputFingerprint: string,
): WorkspaceStageState[] {
  return SLIDE_STAGE_ORDER.map((stage) => ({
    schemaVersion: SCHEMA_VERSION,
    stage,
    status: stage === "init" ? "completed" : "pending",
    latestAttemptId: stage === "init" ? initAttemptId : null,
    lastSuccessfulAttemptId: stage === "init" ? initAttemptId : null,
    completedInputFingerprint: stage === "init" ? initInputFingerprint : null,
    invalidatedAt: null,
    invalidationReason: null,
  }));
}

export function invalidateStageAndDownstream(
  states: readonly WorkspaceStageState[],
  stage: SlideStage,
  reason: string,
  invalidatedAt: string,
): WorkspaceStageState[] {
  if (reason.trim().length === 0) {
    throw new FoundationError("INVALID_STAGE_STATE", "阶段失效原因不能为空", {
      stage,
    });
  }

  const targets = new Set<SlideStage>([stage, ...getDownstreamStages(stage)]);
  return states.map((state) => {
    if (!targets.has(state.stage) || state.status === "pending") {
      return state;
    }
    return {
      ...state,
      status: "stale",
      invalidatedAt,
      invalidationReason: reason,
    };
  });
}

export function assertStageDependenciesCompleted(
  states: readonly WorkspaceStageState[],
  stage: SlideStage,
): void {
  const byStage = new Map(states.map((state) => [state.stage, state]));
  const incomplete = getStageDependencies(stage).filter(
    (dependency) => byStage.get(dependency)?.status !== "completed",
  );
  if (incomplete.length > 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      `阶段 ${stage} 的前置阶段尚未完成：${incomplete.join(", ")}`,
      { stage, incomplete },
    );
  }
}

export function isStageReusable(
  state: WorkspaceStageState,
  inputFingerprint: string,
): boolean {
  return (
    state.status === "completed" &&
    state.completedInputFingerprint === inputFingerprint
  );
}
