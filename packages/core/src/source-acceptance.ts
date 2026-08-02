import { z } from "zod";
import type {
  WorkspaceAsset,
  WorkspaceStageAttempt,
  WorkspaceStageState,
} from "./workspace-contracts.js";

/**
 * 自动放行的 attempt provider 标识（M5 父任务 design §4.5）。
 *
 * `imported` / `extracted` 的 `accept-source` 在建立工作区或换源时置为 `completed`，
 * 但**不写** `accepted.json`、不建验收资产——事实只记在该阶段 attempt 的这个 provider 上。
 *
 * 常量落在 core 而不是 CLI：它既是产生端的写入值，也是消费端（`deck status`、
 * 桌面端、`slide report`）的判据，两侧必须是同一个字面量。此前它只有产生端、
 * 全仓零消费端，于是「人工确认」与「按来源自动放行」在任何报告里都分不出来
 * （2026-08-02 阶段三走查实证，父任务 A10 后半）。
 */
export const AUTO_SOURCE_TRUST_PROVIDER = "auto-source-trust";

/**
 * 这一页的源图确认是**怎么**通过的。
 *
 * - `manual`：有人真的看过并签了字，磁盘上存在对应的 `ArtifactAcceptance`
 * - `auto`：按来源自动放行，磁盘上**没有** `accepted.json`
 * - `pending`：还欠一次确认（`accept-source` 未完成，含被人工失效后的 `stale`）
 *
 * 用 schema 而非裸联合类型：`SlideReport.source.acceptance` 要落盘，落盘的取值集合
 * 必须与判定函数的返回集合是同一个来源，否则两边各加一档就会静默分叉。
 */
export const SourceAcceptanceModeSchema = z.enum(["manual", "auto", "pending"]);

export type SourceAcceptanceMode = z.infer<typeof SourceAcceptanceModeSchema>;

/**
 * 三档的中文短语 —— CLI 的 `deck status` / `slide report` 与桌面端界面共用一张表。
 *
 * 措辞是这个区分的**全部意义**：`auto` 必须说清「按来源」而不是含糊的「已确认」，
 * 否则报告读起来仍然像是有人签过字。
 */
export const SOURCE_ACCEPTANCE_TEXT: Readonly<
  Record<SourceAcceptanceMode, string>
> = {
  manual: "人工确认",
  auto: "按来源自动放行",
  pending: "待确认",
};

/** `resolveSourceAcceptanceMode` 只需要 manifest 的这三样，便于测试构造最小夹具 */
export interface SourceAcceptanceView {
  readonly stages: readonly WorkspaceStageState[];
  readonly attempts: readonly WorkspaceStageAttempt[];
  readonly assets: readonly WorkspaceAsset[];
}

/**
 * 判定源图确认的性质 —— **消费端唯一判据**，CLI 与桌面端都调这一个函数。
 *
 * ## 判据取磁盘事实，不按来源类型反推
 *
 * 写成 `source.kind === "generated" ? "manual" : "auto"` 是错的：
 *
 * - **生成页尚未确认**：来源是 `generated`，按来源反推会报成「人工确认」，而事实
 *   是没有任何人看过它——正是 M4 列为头号风险的「记录与事实相反」。
 * - **换源后的过渡态**：换源把 `accept-source` 打成 `stale`，来源字段却已经是新的，
 *   反推会在「旧图的验收记录还躺在磁盘上、新图一眼没看过」时给出确定的结论。
 * - 反推还会随「哪些来源需要人工确认」（`requiresSourceAcceptance`）一起漂：那条
 *   规则改一次，所有反推点都得跟着改，而它们不会同时被想起来。
 *
 * 顺带一条现状：非生成页被人工失效掉 `accept-source` 之后**目前还无法重新确认**
 * （`runAcceptSource` 按来源拒绝了它），所以 `manual` 眼下只会出现在生成页上。
 * 本函数不依赖这条现状——那个入口一旦打开，判定不需要跟着改。
 *
 * ## 三条判据的顺序不可交换
 *
 * 1. 阶段未 `completed` → `pending`。`stale`（被上游变更或人工失效）同样是欠着的
 *    一次确认，不能因为它「曾经完成过」就报成已确认。
 * 2. 当前那次成功 attempt 的 `provider` 是自动放行标识 → `auto`。这是产生端留下的
 *    正面标记，最可信。
 * 3. 存在**绑到当前那次 attempt 的** `source_acceptance` 资产 → `manual`。
 *
 * 剩下的一律落 `auto`：M3/M4 时代的旧工作区经 `normalizeSlideManifest` 补出的
 * `accept-source` 沿用的是 `init` 阶段的 attempt id（provider 为 `ppt-maker-cli`，
 * 不是自动放行标识，也没有验收资产）。它们全是导入页、按 D6 本就自动放行，
 * 报成 `auto` 与事实一致；**绝不能因为「provider 不是 auto」就报成人工确认**，
 * 那会给每一个历史工作区凭空捏造一条人工痕迹。
 *
 * 资产按 `attemptId` 选取而非裸 `role`：换源会把上一代验收记录归档
 * （`stages/source/archived/<initAttemptId>/accepted.json`），归档件的 role 不变、
 * 文件也确实在，裸 `find` 会把它当成当前那份（《跨层契约》〈多代资产与「当前产物」
 * 选取契约〉）。
 */
export function resolveSourceAcceptanceMode(
  manifest: SourceAcceptanceView,
): SourceAcceptanceMode {
  const state = manifest.stages.find(
    (entry) => entry.stage === "accept-source",
  );
  if (state === undefined || state.status !== "completed") {
    return "pending";
  }

  const attemptId = state.lastSuccessfulAttemptId;
  if (attemptId === null) {
    return "auto";
  }

  const attempt = manifest.attempts.find((entry) => entry.id === attemptId);
  if (attempt?.provider === AUTO_SOURCE_TRUST_PROVIDER) {
    return "auto";
  }

  const acceptance = manifest.assets.find(
    (asset) =>
      asset.role === "source_acceptance" && asset.attemptId === attemptId,
  );
  return acceptance === undefined ? "auto" : "manual";
}
