import {
  invalidateStageAndDownstream,
  requiresSourceAcceptance,
  type SlideStage,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import {
  buildSourceGate,
  loadSlideWorkspace,
  writeWorkspaceManifest,
} from "./workspace.js";

export interface InvalidateSlideStageOptions {
  readonly workspacePath: string;
  readonly stage: SlideStage;
  readonly reason: string;
}

export interface InvalidateSlideStageResult {
  /** 实际由 completed 转为 stale 的阶段；pending 阶段不受影响，故可能为空 */
  readonly invalidated: readonly SlideStage[];
}

/**
 * 失效波及到 `accept-source` 时，按来源重新判定这道闸门（design §4.5）。
 *
 * `imported` / `extracted` 的源图确认**不是一次人工动作，而是来源规则的结论**——
 * 「这一页的图是不是已被信任」这个布尔量由 `requiresSourceAcceptance` 单点给出。
 * 把它留在 `stale` 上会造出一个谁都解不开的状态：`runAcceptSource` 对非生成页
 * 直接拒绝（那条拒绝是对的，否则会凭空产生一条假的人工痕迹），而 `run --from`
 * 停在这道门上给出的下一条命令恰恰就是它——**CLI 与界面双双是死路**
 * （2026-08-02 实测：`run --from ocr` 提示跑 `slide accept-source`，跑了必抛
 * `INVALID_STAGE_STATE`）。
 *
 * 这不是新机制：`replaceSlideSource` 第 5 步早就是「先失效 accept-source、
 * 再按新来源重判」，用的就是同一个 `buildSourceGate`。缺的只是让另一条失效路径
 * 也走这一步。重判后闸门回到 completed，**下游仍然是 stale**——「从该阶段重跑」
 * 想要的正是这个结果。
 *
 * 一个刻意留下的边界：`init` 自身未完成（例如显式失效了 init）时不重判。
 * 那时源图本身就在存疑状态，放行它会与 `assertStageDependenciesCompleted` 打架；
 * 而 `init` 不在 `RUN_SEQUENCE` 里、本来就没有重跑路径，属另一件事。
 */
function reReleaseAutoSourceGate(
  manifest: {
    readonly source: Parameters<typeof requiresSourceAcceptance>[0];
    readonly attempts: readonly { readonly stage: string }[];
  },
  stages: readonly WorkspaceStageState[],
  at: string,
): {
  readonly stages: WorkspaceStageState[];
  readonly attempts: WorkspaceStageAttempt[];
} {
  const gateState = stages.find((state) => state.stage === "accept-source");
  const initState = stages.find((state) => state.stage === "init");
  if (
    gateState === undefined ||
    gateState.status === "completed" ||
    requiresSourceAcceptance(manifest.source) ||
    initState?.status !== "completed" ||
    initState.completedInputFingerprint === null
  ) {
    return { stages: [...stages], attempts: [] };
  }

  const gate = buildSourceGate(
    manifest.source,
    initState.completedInputFingerprint,
    at,
    manifest.attempts.filter((attempt) => attempt.stage === "accept-source")
      .length + 1,
  );
  const preCompleted = gate.preCompleted[0];
  if (preCompleted === undefined) {
    return { stages: [...stages], attempts: [] };
  }
  return {
    stages: stages.map((state) =>
      state.stage === "accept-source"
        ? {
            ...state,
            status: "completed",
            latestAttemptId: preCompleted.attemptId,
            lastSuccessfulAttemptId: preCompleted.attemptId,
            completedInputFingerprint: preCompleted.inputFingerprint,
            invalidatedAt: null,
            invalidationReason: null,
          }
        : state,
    ),
    attempts: gate.attempts,
  };
}

/**
 * 把指定阶段及其下游标记为 stale，使后续 run 强制重做而不是幂等跳过。
 *
 * 既有的失效路径（ocr / review / mask / clean / pptx 各自的 run）无一例外都由
 * "输入指纹变化"自动触发，表达的是**上游变了、产物过期**。人工拒绝验收是另一种
 * 语义：输入一字未改，但产物质量不合格。缺这条路径时 `run --from clean` 会因为
 * clean 仍是 completed 被 run-from 的守卫整段跳过，执行器直接滑到 accept-clean
 * 闸门原地返回——用户看到的就是"点重跑毫无反应"。即便绕过守卫也没用：
 * runSlideClean 内部的 isStageReusable 同样认 completed + 指纹，会复用旧产物。
 * 标 stale 后两道判断一并放行。
 */
export async function invalidateSlideStage(
  options: InvalidateSlideStageOptions,
): Promise<InvalidateSlideStageResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const before = new Map(
    workspace.manifest.stages.map((state) => [state.stage, state.status]),
  );
  const now = new Date().toISOString();
  const invalidated = invalidateStageAndDownstream(
    workspace.manifest.stages,
    options.stage,
    options.reason,
    now,
  );
  const gate = reReleaseAutoSourceGate(workspace.manifest, invalidated, now);
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    stages: gate.stages,
    attempts: [...workspace.manifest.attempts, ...gate.attempts],
  });
  const stages = gate.stages;
  return {
    invalidated: stages
      .filter(
        (state) =>
          state.status === "stale" && before.get(state.stage) !== "stale",
      )
      .map((state) => state.stage),
  };
}
