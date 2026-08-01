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
    // 源图确认闸门（D6）。ocr 改依赖它而非 init：闸门因此由 core 的
    // assertStageDependenciesCompleted 统一兜底，CLI 与桌面端都绕不过去，
    // 不需要在每个消费方各写一遍「这页要不要先确认源图」。
    "accept-source": ["init"],
    ocr: ["accept-source"],
    review: ["ocr"],
    "assist-review": ["review"],
    mask: ["assist-review"],
    clean: ["mask"],
    "accept-clean": ["clean"],
    // pptx 只依赖 clean 产物本身：人工验收已收敛到最终产物确认这一个停点，
    // 先出 PPTX、再一次性验收 clean 与 pptx（design §3.2）。
    pptx: ["clean"],
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

/** 建立工作区时即已完成的非 init 阶段（目前只有自动放行的 `accept-source`） */
export interface PreCompletedStage {
  readonly stage: SlideStage;
  readonly attemptId: string;
  readonly inputFingerprint: string;
}

export function createInitialStageStates(
  initAttemptId: string,
  initInputFingerprint: string,
  /**
   * 来源自动放行时传 `accept-source`。core 不判断「哪种来源要自动放行」——
   * 那是来源规则（`requiresSourceAcceptance`），由调用方决定后把结论传进来，
   * 阶段图本身对三种来源完全相同。
   */
  preCompleted: readonly PreCompletedStage[] = [],
): WorkspaceStageState[] {
  const byStage = new Map(preCompleted.map((entry) => [entry.stage, entry]));
  return SLIDE_STAGE_ORDER.map((stage) => {
    if (stage === "init") {
      return {
        schemaVersion: SCHEMA_VERSION,
        stage,
        status: "completed" as const,
        latestAttemptId: initAttemptId,
        lastSuccessfulAttemptId: initAttemptId,
        completedInputFingerprint: initInputFingerprint,
        invalidatedAt: null,
        invalidationReason: null,
      };
    }
    const done = byStage.get(stage);
    if (done !== undefined) {
      return {
        schemaVersion: SCHEMA_VERSION,
        stage,
        status: "completed" as const,
        latestAttemptId: done.attemptId,
        lastSuccessfulAttemptId: done.attemptId,
        completedInputFingerprint: done.inputFingerprint,
        invalidatedAt: null,
        invalidationReason: null,
      };
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      stage,
      status: "pending" as const,
      latestAttemptId: null,
      lastSuccessfulAttemptId: null,
      completedInputFingerprint: null,
      invalidatedAt: null,
      invalidationReason: null,
    };
  });
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

/**
 * 需要用户处理的那一个阶段：真失败优先，其次才是失效；都没有则 `null`。
 *
 * **不能用「最后一个已完成阶段的下一个」顶替。** 那对字段是错位的：前者是进度，
 * 后者是故障，拼起来就成了「阶段「已完成的那个」上游已变更」。换源后
 * `init` / `accept-source` 都 completed、`ocr` stale，错位口径会指着 `accept-source`
 * 报失败——一个明明完成了的阶段（2026-08-01 实测）。它还会漏报：失败阶段不紧挨着
 * 最后一个已完成阶段时（中间夹着 pending），错位口径根本看不见那个失败。
 *
 * `failed` / `interrupted` 排在 `stale` 前：一页同时有真失败与失效时，用户要先看见
 * 失败的那个——失效只要重跑，失败得先修。
 *
 * **单点定义**：CLI 的 `deck status` 与桌面端的 `blockingStageView` 是同一个判据，
 * 两侧对同一个 deck 的说法不得分叉。桌面端的版本作用在合并了会话层的展示视图上，
 * 纯耐久层的消费方一律调本函数。
 */
export function findBlockingStage(
  states: readonly WorkspaceStageState[],
): WorkspaceStageState | null {
  const byStage = new Map(states.map((state) => [state.stage, state]));
  const ordered = SLIDE_STAGE_ORDER.map((stage) => byStage.get(stage)).filter(
    (state): state is WorkspaceStageState => state !== undefined,
  );
  return (
    ordered.find(
      (state) => state.status === "failed" || state.status === "interrupted",
    ) ??
    ordered.find((state) => state.status === "stale") ??
    null
  );
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
