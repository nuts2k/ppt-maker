import { invalidateStageAndDownstream, type SlideStage } from "@ppt-maker/core";
import { loadSlideWorkspace, writeWorkspaceManifest } from "./workspace.js";

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
  const stages = invalidateStageAndDownstream(
    workspace.manifest.stages,
    options.stage,
    options.reason,
    new Date().toISOString(),
  );
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    stages,
  });
  return {
    invalidated: stages
      .filter(
        (state) =>
          state.status === "stale" && before.get(state.stage) !== "stale",
      )
      .map((state) => state.stage),
  };
}
