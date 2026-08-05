/**
 * 内容策划工作台中需要跨组件复用、且值得用纯函数上锁的规则。
 *
 * 本文件不触碰 `window`，并保持相对 `.js` 导入，使 renderer 与 NodeNext 下的
 * vitest 能消费同一份实现。
 */

import {
  type ContentSpec,
  type ContentSpecEntry,
  diffContentSpec,
  type SpecChangeRecord,
} from "@ppt-maker/core";
import type {
  SlideDetail,
  SourceTaskRequest,
  SourceTaskResult,
} from "../../main/ipc/channels.js";
import {
  type ConfirmOptions,
  type SpecPageSummary,
  summarizeSpec,
} from "./source-picker-core.js";

/** 编辑草稿是否包含尚未保存的规格变更。 */
export function isDirty(
  saved: ContentSpec | null,
  draft: ContentSpec | null,
): boolean {
  if (draft === null) return false;
  if (saved === null) return true;

  const diff = diffContentSpec(saved, draft);
  return (
    diff.styleChanged ||
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.modified.length > 0 ||
    diff.reordered
  );
}

export interface OutdatedPageClassification {
  readonly drifted: readonly SlideDetail[];
  readonly missing: readonly SlideDetail[];
  /** 非生成来源与已移除页，不参与规格重生成。 */
  readonly notApplicable: readonly SlideDetail[];
}

/**
 * 把页面按规格重生成能力分类。
 *
 * 已同步或尚无漂移状态的生成页不属于任何返回集合；调用方只需要展示必须处理或
 * 明确不适用的页面。
 */
export function classifyOutdatedPages(
  slides: readonly SlideDetail[],
): OutdatedPageClassification {
  const drifted: SlideDetail[] = [];
  const missing: SlideDetail[] = [];
  const notApplicable: SlideDetail[] = [];

  for (const slide of slides) {
    if (slide.sourceKind !== "generated") {
      notApplicable.push(slide);
    } else if (slide.specDrift === "drifted") {
      drifted.push(slide);
    } else if (slide.specDrift === "missing") {
      missing.push(slide);
    }
  }

  return { drifted, missing, notApplicable };
}

/**
 * 规格里有条目、deck 里还没建页的那些条目（对应 CLI 对账的 `newEntries`）。
 *
 * ## 口径必须与 CLI 逐条对齐
 *
 * 判据的权威实现是 `collectGeneratedPages`（`apps/cli/src/deck/content-spec.ts`）：
 * 它扫 deck 时做**两道过滤**——跳过已软删除的页（`removedAt !== null`）、跳过
 * `source.kind !== "generated"` 的页。这里少任何一条，界面上的「待建 N 条」就与
 * 实际建出的页数对不上，而付费确认框写的正是这个 N——数字不准，付费门槛就失去意义。
 *
 * 由此推出一条**既有语义**，本函数第一次把它暴露到界面上：一页被软删除后，
 * 它的规格条目会重新出现在待建列表里，再建一次会得到一页新的。这不是缺陷，
 * 但两侧任一改了过滤条件都必须同时改这里，故用例把它钉住。
 *
 * 这里刻意**不复算漂移**：`drifted` 由 `classifyOutdatedPages` 负责，两档并排显示。
 */
export function classifyPendingEntries(
  spec: ContentSpec | null,
  slides: readonly SlideDetail[],
): readonly ContentSpecEntry[] {
  if (spec === null) return [];

  const builtEntryIds = new Set<string>();
  for (const slide of slides) {
    if (slide.removed) continue;
    if (slide.sourceKind !== "generated") continue;
    if (slide.specEntryId === null) continue;
    builtEntryIds.add(slide.specEntryId);
  }

  return spec.entries.filter((entry) => !builtEntryIds.has(entry.specEntryId));
}

/**
 * 待建条目的可读呈现（页型 + 一行标题）。
 *
 * 条目尚未建页，没有 `pageLabel`，裸 `specEntryId` 对用户毫无意义；初稿列表已经
 * 解决过同一个呈现问题，因此复用 `summarizeSpec` 再按待建 id 过滤——
 * **不改 `summarizeSpec` 的签名**去迁就条目子集，那会让「整份规格的摘要」这个
 * 既有语义变得含糊。顺序沿用规格顺序。
 */
export function pendingEntrySummaries(
  spec: ContentSpec | null,
  slides: readonly SlideDetail[],
): readonly SpecPageSummary[] {
  if (spec === null) return [];

  const pendingIds = new Set(
    classifyPendingEntries(spec, slides).map((entry) => entry.specEntryId),
  );
  return summarizeSpec(spec).filter((summary) =>
    pendingIds.has(summary.specEntryId),
  );
}

/**
 * 按规格建页的付费确认。
 *
 * **不复用 `buildGenerateConfirm`**：那条写的是「最多 N 次，实际可能更少」，因为
 * SourcePicker 传的是整份规格、由 CLI 侧对账决定跳过哪些。这里的 N 是用户逐条勾选
 * 出来的待建条目，勾选集合即执行集合，次数是**确切值**。把确切次数塞进「最多」的
 * 文案里，等于让用户以为可能更少——付费门槛的可信度就是靠这个数字立住的。
 */
export function buildCreatePagesConfirm(count: number): ConfirmOptions {
  return {
    title: "确认按规格建页",
    message: `将调用 ${count} 次图像生成`,
    detail: `将按当前规格建立 ${count} 页，按次计费且不可撤销。生成后每页都需要你逐张确认源图，之后才会进入流水线。`,
    confirmLabel: `建页（${count} 页）`,
  };
}

/**
 * 「规格影响」面板是否有内容可显示。
 *
 * 三类**任一非空**即渲染。此前判据只看过时与失联两类，于是零页 deck（待建 N 条、
 * 另两类皆空）看到的是一句「当前没有已过时或失联页面」——规格产出之后最该出现
 * 「把它建成页」的那一刻，界面上恰好什么都没有。
 */
export function hasSpecImpact(counts: {
  readonly pending: number;
  readonly drifted: number;
  readonly missing: number;
}): boolean {
  return counts.pending > 0 || counts.drifted > 0 || counts.missing > 0;
}

/**
 * 「规格影响」面板全空时说什么。
 *
 * 面板的三类全都算在**已保存的规格**上（待建条目取 `saved`，建页由 CLI 读磁盘），
 * 而它正上方的编辑器显示的是 `draft ?? saved`。有未保存草稿时两者并不是一份东西：
 * 草稿里新加的条目一条都不会出现在待建页。此时若照说「规格里的每个条目都已建成
 * 页面」，用户正看着编辑器里那条还没建的条目，界面就在说假话——而这一档恰好没有
 * 任何按钮，也就没有 `specActionBlockedReason` 那样的地方去解释。
 */
export function specImpactEmptyCopy(dirty: boolean): string {
  if (dirty) {
    return "已保存的规格里每个条目都已建成页面，也没有已过时或失联页面。未保存的草稿要先保存，才会出现在待建页。";
  }
  return "规格里的每个条目都已建成页面，也没有已过时或失联页面。";
}

/** 勾选出的待建条目 id，保持规格顺序。 */
export function selectedPendingEntryIds(
  pending: readonly { readonly specEntryId: string }[],
  selected: ReadonlySet<string>,
): readonly string[] {
  return pending
    .map((item) => item.specEntryId)
    .filter((specEntryId) => selected.has(specEntryId));
}

/**
 * 「规格影响」面板里两个动作（建页 / 重生成）共用的禁用理由。
 *
 * 两档并排，措辞只差一个动作词。各写一份的话，迟早只改其中一句——而两句说法不一
 * 会让用户以为这是两种不同性质的限制（M6 的 `formatSpecHistoryWarning` 已有同款教训）。
 *
 * **脏草稿必须禁用**：两个动作都由 CLI 读磁盘上的规格执行，草稿里的东西不在磁盘上，
 * 放行就会按一份用户没看过的规格出图，而钱已经花了。
 */
export function specActionBlockedReason(params: {
  readonly dirty: boolean;
  readonly running: boolean;
  readonly verb: "建页" | "重生成";
}): string | null {
  if (params.dirty) return `请先保存规格，再按磁盘现值${params.verb}`;
  if (params.running) return "已有建页任务正在执行";
  return null;
}

export interface CreatePagesAction {
  readonly label: string;
  readonly disabled: boolean;
  /** 禁用原因；可点时为 null */
  readonly title: string | null;
}

/**
 * 「建立所选 N 页」按钮的文案与禁用判据。
 *
 * **一条都没勾必须禁用**：`entryIds` 的省略与 `[]` 在 CLI 侧语义不同——省略是
 * 「建全部待建条目」，`[]` 会被 `SPEC_SELECTION_EMPTY` 整体拒绝。发一个空数组过去
 * 的结果是界面弹一条看不懂的报错，而用户只是没勾任何东西。
 */
export function resolveCreatePagesAction(params: {
  readonly selectedCount: number;
  readonly dirty: boolean;
  readonly running: boolean;
}): CreatePagesAction {
  return {
    label: `建立所选 ${params.selectedCount} 页`,
    disabled: params.selectedCount === 0 || params.dirty || params.running,
    title: specActionBlockedReason({ ...params, verb: "建页" }),
  };
}

export interface CreatePagesSummary {
  readonly created: number;
  readonly failed: number;
  /** 勾了却没被执行的条目数——只有这些才是真正的「此前已经建过页」 */
  readonly alreadyBuilt: number;
  /** 提示末尾的补充说明，按顺序拼；没有可说的就是空数组 */
  readonly notes: readonly string[];
}

/**
 * 建页结果说给用户听。
 *
 * ## 为什么**不吃** `result.skipped`
 *
 * T1 给 `runDeckGenerate` 加了 `entryIds` 之后，CLI 的 `skipped` 是
 * `spec.entries − targets`（`generate.ts:309`），里面混了两类完全不同的东西：
 *
 * 1. 此前已经建过页的条目——`skipped` 的原始含义；
 * 2. **本次没被勾选的条目**——`entryIds` 过滤掉的，用户自己刚做的操作。
 *
 * 默认全选时第 2 类恒为 0，怎么写都看不出来；一旦用户取消勾选就必然说反。走查实测：
 * 待建 4 条、勾 1 条、建成 1 页，`skipped` 是 3，界面照着 `skipped` 说「被跳过的条目
 * 此前已经建过页」——那 3 条一次都没建过，同一屏的待建页一档正说着「待建页 3 条」。
 *
 * 第 2 类**根本不需要报**：那是用户自己取消勾选的，报了反而像出了意外。而渲染层
 * 知道用户勾了几条，于是不必去拆 `skipped`，直接算「勾了却没执行的」即可：
 *
 * ```
 * alreadyBuilt = requested − created − failed
 * ```
 *
 * 这个口径比「`skipped` 减去未勾选数」更紧：后者会把**用户从没勾过、也不在待建页里**
 * 的那些历史条目一并报出来（10 条规格里 6 条早已建好，勾 1 条就会报「6 条已建过页」），
 * 而用户问的从来只是「我勾的那些怎么样了」。
 *
 * 剩下的 `alreadyBuilt > 0` 才是真正值得说的意外：勾的时候还在待建页，发起时已经
 * 被别处建掉了。
 */
export function summarizeCreatePages(params: {
  readonly requested: number;
  readonly created: number;
  readonly failed: number;
}): CreatePagesSummary {
  // 钳到 0：三个数来自两次不同的读取，真出现不一致时宁可不报，也不报个负数
  const alreadyBuilt = Math.max(
    0,
    params.requested - params.created - params.failed,
  );

  const notes: string[] = [];
  if (params.created > 0) notes.push("每页都需要你逐张确认源图。");
  if (alreadyBuilt > 0) {
    notes.push(
      `勾选的条目里有 ${alreadyBuilt} 条在发起前已经建出页面，本次没有重复建。`,
    );
  }
  /*
   * 不写「逐条原因见活动日志」：活动日志里只有一条汇总记录
   * （`source-task-runner.ts` 的 `record` 写的是 `result.message`），
   * 逐条失败原因只出现在执行期间的进度事件里，跑完就没了。指一个空处比不指更糟。
   */
  if (params.failed > 0) {
    notes.push("失败的条目仍留在待建页，可以再试一次。");
  }

  return {
    created: params.created,
    failed: params.failed,
    alreadyBuilt,
    notes,
  };
}

export interface CreatePagesDeps {
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** 发起建页；结果被丢弃（期间切了工作区）时返回 null */
  start(request: SourceTaskRequest): Promise<SourceTaskResult | null>;
}

/**
 * 「按规格建页」的编排：付费确认 → 发起任务 → 交回结果。
 *
 * 依赖注入、不碰 store 也不碰视图，是为了能在没有 DOM 测试库的本仓直接单测。
 * **刻意不含任何导航依赖**：建完留在策划页（父任务 D5），自动跳走会打断还想继续
 * 改规格的人；顺带地，这里没有导航能力，也就没人能在这条路上偷偷加一次跳转。
 *
 * 同样**不含 refreshStatus**：`runSourceTask` 在受理成功后已经刷过一次 deck 状态，
 * 待建页一档随之收缩。在这里再刷一次只是多一次 IPC，且会让「谁负责刷新」出现两个答案。
 *
 * 返回 `null` 的三种情形调用方都不必额外处理：用户取消（什么都没发生）、
 * 一条都没勾（同上）、结果被丢弃（切了工作区，那次结果不属于当前 deck）。
 */
export async function createPagesFlow(
  deps: CreatePagesDeps,
  entryIds: readonly string[],
): Promise<SourceTaskResult | null> {
  if (entryIds.length === 0) return null;
  if (!(await deps.confirm(buildCreatePagesConfirm(entryIds.length)))) {
    return null;
  }
  // 不传 specPath：让 CLI 读 deck 内的权威规格，而不是某个外部文件
  return deps.start({ kind: "generate", entryIds });
}

/** 批量重生成的付费确认；勾选集合即实际执行集合，因此次数是确切值。 */
export function buildRegenerateBatchConfirm(
  pageLabels: readonly string[],
): ConfirmOptions {
  const count = pageLabels.length;
  return {
    title: "确认批量重生成",
    message: `将调用 ${count} 次图像生成`,
    detail: `将重生成 ${count} 页，按次计费且不可撤销。这些页面的 OCR 复核基准会随规格文字一并更新，生成后每页都需要你逐张重新确认源图。`,
    confirmLabel: `重生成（${count} 页）`,
  };
}

/** 没有任何条目指纹变化的历史记录仍保留，但在界面中降低视觉权重。 */
export function isEmptyChangeRecord(record: SpecChangeRecord): boolean {
  return record.fingerprints.length === 0;
}
