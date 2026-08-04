// `content-spec.json` 的**唯一写入入口**与过时预告（M6 子任务① design §4 §5 §8）。
//
// 为什么必须唯一：变更日志靠写入路径**捎带**落盘。留第二条写入路径，日志就会漏记，
// 而漏记的表现是「历史里没有这次改动」——一种事后无法察觉、也无法补救的静默损坏。
// 因此 `writeDeckContentSpec` 的唯一合法调用方是本文件的 `applySpecChange`。
//
// 为什么入口在 CLI 而不在 core：口径唯一来源 `specViewFingerprint` 要 `node:crypto`，
// 而 core 被渲染进程直接 import，不能拉进 Node 内置模块（`content-spec-contracts.ts:135`）。
// core 只放类型与纯函数（`diffContentSpec` / `applyRollbackToSpec`），文件与哈希留在这里。
import { randomUUID } from "node:crypto";
import {
  type ApplySpecChangeResult,
  applyRollbackToSpec,
  type ContentSpec,
  type ContentSpecDiff,
  ContentSpecSchema,
  type DriftedPage,
  diffContentSpec,
  FoundationError,
  type PreviewSpecChangeResult,
  SPEC_CHANGE_RECORD_V,
  type SpecChangeFingerprint,
  type SpecChangeOrigin,
  type SpecChangeRecord,
} from "@ppt-maker/core";
import { specViewFingerprint } from "../providers/page-generation.js";
import {
  collectGeneratedPages,
  type GeneratedPageRef,
  loadDeckContentSpec,
  reconcileDeckSpec,
  type SpecReconciliation,
  writeDeckContentSpec,
} from "./content-spec.js";
import {
  appendSpecChangeRecord,
  listSpecChangeRecords,
} from "./planning-store.js";
import { loadDeckWorkspace } from "./workspace.js";

export type {
  ApplySpecChangeResult,
  DriftedPage,
  PreviewSpecChangeResult,
} from "@ppt-maker/core";

export interface ApplySpecChangeOptions {
  readonly deckPath: string;
  /** 全量新规格；`specEntryId` 由调用方分配，模型不得编造 */
  readonly nextSpec: ContentSpec;
  readonly origin: SpecChangeOrigin;
  readonly summary: string;
  readonly conversationRef?: string | null;
  readonly rollbackOf?: string | null;
  /** 测试注入 */
  readonly now?: () => string;
  /** 测试注入 */
  readonly newRecordId?: () => string;
}

/**
 * 「之前那份规格」的基准。
 *
 * `previous === null`（C3 的首次导入）时用**同 style、零条目**的规格做基准，而不是
 * 空字符串 style：`SpecChangeRecordSchema` 的 `styleBefore` 走
 * `ContentSpecStyleSchema`（`description` 非空），写一条空 style 的记录会被
 * `listSpecChangeRecords` 的 `safeParse` 当坏行**静默丢弃**——写进去了却读不出来，
 * 正是漏记的另一种形态。同 style + 零条目也如实表达了「此前什么都没有」：
 * 全部条目都是新增，`styleChanged` 为 false 时不该谎称风格变过。
 */
function baselineOf(
  previous: ContentSpec | null,
  next: ContentSpec,
): ContentSpec {
  return previous ?? { ...next, entries: [] };
}

/** 前后两份规格的条目 id 并集，顺序确定：先 after 顺序，再把只在 before 的按 before 顺序追加 */
function orderedEntryIds(before: ContentSpec, after: ContentSpec): string[] {
  const afterIds = after.entries.map((entry) => entry.specEntryId);
  const inAfter = new Set(afterIds);
  return [
    ...afterIds,
    ...before.entries
      .map((entry) => entry.specEntryId)
      .filter((id) => !inAfter.has(id)),
  ];
}

/**
 * 受影响条目的新旧指纹。
 *
 * **style 变了则所有条目都是受影响条目**：style 进指纹投影
 * （`specViewFingerprintValues` 首位就是 `style:`），改它波及全 deck，靠「哪几条条目
 * 被编辑过」表达不了。style 没变时只取真正改了内容的条目——纯位置变化不改指纹，
 * 不该让任何页面被报成过时（`diffContentSpec` 已把它单独记为 `reordered`）。
 */
function buildFingerprints(
  before: ContentSpec,
  after: ContentSpec,
  diff: ContentSpecDiff,
): SpecChangeFingerprint[] {
  const changed = new Set([...diff.added, ...diff.removed, ...diff.modified]);
  const beforeById = new Map(
    before.entries.map((entry) => [entry.specEntryId, entry]),
  );
  const afterById = new Map(
    after.entries.map((entry) => [entry.specEntryId, entry]),
  );

  const fingerprints: SpecChangeFingerprint[] = [];
  for (const specEntryId of orderedEntryIds(before, after)) {
    if (!diff.styleChanged && !changed.has(specEntryId)) {
      continue;
    }
    const previousEntry = beforeById.get(specEntryId);
    const nextEntry = afterById.get(specEntryId);
    fingerprints.push({
      specEntryId,
      before:
        previousEntry === undefined
          ? null
          : specViewFingerprint(before.style, previousEntry),
      after:
        nextEntry === undefined
          ? null
          : specViewFingerprint(after.style, nextEntry),
    });
  }
  return fingerprints;
}

/**
 * 一页在某份规格下的指纹——**不另写比对逻辑**，只从 `reconcileDeckSpec` 的产出反推。
 *
 * 该页在这份规格下被报为 drifted 时，指纹就是它算出的 `currentSha256`；被报为失联
 * 时该条目已不存在，指纹为 `null`；两者都不是即 in-sync，指纹等于页面记录的
 * `specEntrySha256`。规格不存在（首次导入前）时没有可言的指纹。
 */
function fingerprintUnder(
  page: GeneratedPageRef,
  reconciliation: SpecReconciliation | null,
): string | null {
  if (reconciliation === null) {
    return null;
  }
  const drift = reconciliation.drifted.find(
    (item) => item.specEntryId === page.specEntryId,
  );
  if (drift !== undefined) {
    return drift.currentSha256;
  }
  const missing = reconciliation.missingPages.some(
    (item) => item.specEntryId === page.specEntryId,
  );
  return missing ? null : page.specEntrySha256;
}

function toDriftedPage(
  page: GeneratedPageRef,
  before: SpecReconciliation | null,
  after: SpecReconciliation | null,
): DriftedPage {
  return {
    slideId: page.entry.slideId,
    pageLabel: page.pageLabel,
    specEntryId: page.specEntryId,
    before: fingerprintUnder(page, before),
    after: fingerprintUnder(page, after),
  };
}

/**
 * 「因这次变更**新增**过时 / 失联的页」。
 *
 * 判据全部来自 `reconcileDeckSpec`——与 `deck status` / `deck generate` 是同一个函数，
 * 不在这里另写一份指纹比对。两处各写一份必然静默漂移：界面说「没改」而页面被标成
 * 过时（或反之），没有任何东西会报错。
 *
 * 已经处于过时的页**不重复计入**：要说的是「确认后 N 页**变为**已过时」。
 */
function newlyAffected(
  pages: readonly GeneratedPageRef[],
  before: SpecReconciliation | null,
  after: SpecReconciliation,
): { drifted: DriftedPage[]; missing: DriftedPage[] } {
  const byEntryId = new Map(pages.map((page) => [page.specEntryId, page]));
  const wasDrifted = new Set(
    (before?.drifted ?? []).map((item) => item.specEntryId),
  );
  const wasMissing = new Set(
    (before?.missingPages ?? []).map((page) => page.specEntryId),
  );

  const drifted: DriftedPage[] = [];
  for (const item of after.drifted) {
    const page = byEntryId.get(item.specEntryId);
    if (page === undefined || wasDrifted.has(item.specEntryId)) {
      continue;
    }
    drifted.push(toDriftedPage(page, before, after));
  }

  const missing: DriftedPage[] = [];
  for (const page of after.missingPages) {
    if (wasMissing.has(page.specEntryId)) {
      continue;
    }
    missing.push(toDriftedPage(page, before, after));
  }

  return { drifted, missing };
}

/**
 * 归一化：`specId` / `createdAt` **强制沿用磁盘现值**，只有磁盘上还没有规格时才用入参的。
 *
 * 这是 D7 保护条 2（id 与时间戳始终由代码分配，外部文件与模型都不得改写）的落点：
 * 一份从外部拿来、或由模型吐出来的规格若能改掉 `specId`，deck 的规格身份就断了。
 */
function normalizeSpec(
  previous: ContentSpec | null,
  next: ContentSpec,
  updatedAt: string,
): ContentSpec {
  return {
    ...next,
    specId: previous?.specId ?? next.specId,
    createdAt: previous?.createdAt ?? next.createdAt,
    updatedAt,
  };
}

/**
 * 规格写入的唯一入口。六步顺序不可拆、不可换序：
 *
 * 1. 读磁盘现值 → 2. 归一化 id 与时间戳 → 3. 校验 → 4. 算差异与新旧指纹
 * → 5. 原子写规格 → 6. 追加变更记录。
 *
 * **第 6 步失败绝不回滚前五步、绝不上抛**，只置 `historyWritten: false`——日志是旁路，
 * 不允许它反过来阻断规格保存（照搬 `apps/desktop/src/main/activity-log.ts` 的纪律）。
 */
export async function applySpecChange(
  options: ApplySpecChangeOptions,
): Promise<ApplySpecChangeResult> {
  const deck = await loadDeckWorkspace(options.deckPath);
  const previous = await loadDeckContentSpec(deck.path);
  // 页面集合与规格文件无关，先读出来：这样任何读取失败都发生在写盘**之前**，
  // 不会留下「规格已改、结果算不出来」的半截状态。
  const pages = await collectGeneratedPages(deck);

  const at = (options.now ?? (() => new Date().toISOString()))();
  const next = ContentSpecSchema.parse(
    normalizeSpec(previous, options.nextSpec, at),
  );

  const baseline = baselineOf(previous, next);
  const diff = diffContentSpec(baseline, next);
  const record: SpecChangeRecord = {
    v: SPEC_CHANGE_RECORD_V,
    recordId: (options.newRecordId ?? randomUUID)(),
    at,
    origin: options.origin,
    summary: options.summary,
    styleBefore: baseline.style,
    styleAfter: next.style,
    entriesBefore: diff.entriesBefore,
    entriesAfter: diff.entriesAfter,
    fingerprints: buildFingerprints(baseline, next, diff),
    conversationRef: options.conversationRef ?? null,
    rollbackOf: options.rollbackOf ?? null,
  };

  await writeDeckContentSpec(deck.path, next);

  const affected = newlyAffected(
    pages,
    previous === null ? null : reconcileDeckSpec(previous, pages),
    reconcileDeckSpec(next, pages),
  );

  let historyWritten = false;
  try {
    historyWritten = await appendSpecChangeRecord(deck.path, record);
  } catch (error) {
    // `appendSpecChangeRecord` 内部已吞掉一切异常，这层兜底是结构性的：
    // 第 6 步的任何异常都不得传播出去，把已经落盘的规格判成失败。
    console.error("[spec-edit] 变更日志写入失败", error);
  }

  return {
    spec: next,
    record,
    historyWritten,
    drifted: affected.drifted,
    missing: affected.missing,
  };
}

/**
 * 过时范围预告（S7）：在**不落盘**的前提下算出「若该规格生效，哪几页变为已过时」。
 *
 * 这是「模型输出全量条目」而非 patch 的直接收益——patch 语义算不出落盘后的指纹，
 * 只能落完再看。确认对话框必须写出这个数字（父任务 design §4.4），不得省略。
 *
 * **不写任何文件**，也不创建 `planning/`。
 */
export async function previewSpecChange(
  deckPath: string,
  nextSpec: ContentSpec,
): Promise<PreviewSpecChangeResult> {
  const deck = await loadDeckWorkspace(deckPath);
  const previous = await loadDeckContentSpec(deck.path);
  const pages = await collectGeneratedPages(deck);

  // 预告也走同一套归一化：否则「预告说 2 页过时、真写完成了 3 页」这种不一致
  // 会在确认对话框上出现，而它恰恰是用来让用户做决定的。
  const next = ContentSpecSchema.parse(
    normalizeSpec(previous, nextSpec, nextSpec.updatedAt),
  );
  const baseline = baselineOf(previous, next);
  const affected = newlyAffected(
    pages,
    previous === null ? null : reconcileDeckSpec(previous, pages),
    reconcileDeckSpec(next, pages),
  );

  return {
    diff: diffContentSpec(baseline, next),
    willDrift: affected.drifted,
    willMiss: affected.missing,
  };
}

export interface RollbackSpecChangeOptions {
  readonly deckPath: string;
  readonly recordId: string;
  /** 测试注入 */
  readonly now?: () => string;
  /** 测试注入 */
  readonly newRecordId?: () => string;
}

/**
 * 回滚到某条记录**之前**的状态。
 *
 * 回滚**不抹历史**：它自身也经统一入口写一条 `origin: "rollback"` 的新纪录。
 * 日志是追加式的，回滚是一次新的前进——界面文案要说清这一点，否则用户会以为
 * 「那次改动被删掉了」。
 */
export async function rollbackSpecChange(
  options: RollbackSpecChangeOptions,
): Promise<ApplySpecChangeResult> {
  const records = await listSpecChangeRecords(options.deckPath);
  const target = records.find((record) => record.recordId === options.recordId);
  if (target === undefined) {
    throw new FoundationError(
      "SPEC_HISTORY_RECORD_NOT_FOUND",
      `变更历史中找不到记录：${options.recordId}`,
      {
        recordId: options.recordId,
        available: records.map((record) => record.recordId),
      },
    );
  }

  const current = await loadDeckContentSpec(options.deckPath);
  if (current === null) {
    throw new FoundationError(
      "INVALID_INPUT",
      "deck 内没有内容规格，无法回滚",
      { deckPath: options.deckPath },
    );
  }

  return applySpecChange({
    deckPath: options.deckPath,
    nextSpec: applyRollbackToSpec(current, target),
    origin: "rollback",
    summary: `回滚：${target.summary}`,
    rollbackOf: target.recordId,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.newRecordId === undefined
      ? {}
      : { newRecordId: options.newRecordId }),
  });
}

// ---------------------------------------------------------------------------
// 输出格式化（S1/S3/S7 的 CLI 面）
//
// 命令回调只做「取参 → 调用 → 打印」，可测的部分全在下面这几个纯函数里——
// 本仓库没有 spawn CLI 的测试先例，把文案留在 action 里就等于放弃测它。
// ---------------------------------------------------------------------------

const ORIGIN_LABELS: Record<SpecChangeOrigin, string> = {
  manual: "人工",
  proposal: "提案",
  rollback: "回滚",
};

/** 页面清单的统一写法，与 `formatDeckStatus` 的「页标签 (条目 id)」一致 */
function formatPageList(pages: readonly DriftedPage[]): string {
  return pages
    .map((page) => `${page.pageLabel} (${page.specEntryId})`)
    .join(", ");
}

/**
 * 落盘结果（`deck spec-apply` / `deck spec-rollback` 的 stdout）。
 *
 * `recordId` 打全不截断——它是 `deck spec-rollback --record` 的唯一入参。
 */
export function formatSpecChangeResult(result: ApplySpecChangeResult): string {
  const lines = [`已保存规格变更：${result.record.recordId}`];
  lines.push(`  摘要: ${result.record.summary}`);
  lines.push(`  来源: ${ORIGIN_LABELS[result.record.origin]}`);
  if (result.record.rollbackOf !== null) {
    lines.push(`  回滚自: ${result.record.rollbackOf}`);
  }
  lines.push(`  受影响条目: ${result.record.fingerprints.length}`);
  lines.push(
    result.drifted.length === 0
      ? "  新增过时: 无"
      : `  新增过时: ${result.drifted.length} 页 — ${formatPageList(result.drifted)}`,
  );
  if (result.missing.length > 0) {
    // `--dry-run` 会预告失联页，落盘后不提就等于让那个数字凭空蒸发。
    // 只在有的时候打印：没有失联页是常态，多一行「无」只会淹没上面那两行。
    lines.push(
      `  新增失联: ${result.missing.length} 页 — ${formatPageList(result.missing)}`,
    );
  }
  return lines.join("\n");
}

/**
 * `historyWritten: false` 时给 **stderr** 的告警；写成功返回 `null`。
 *
 * 变更日志写失败不回滚规格（design §4 第 6 步），但**不能就此沉默**：
 * 用户手上的规格已经改了，而这次改动查不到、也回滚不了。静默吞掉等于回到
 * 没有 `historyWritten` 这个字段的状态。
 */
export function formatSpecHistoryWarning(
  result: ApplySpecChangeResult,
): string | null {
  return result.historyWritten
    ? null
    : "警告：规格已保存，但本次改动未能写入变更历史（planning/spec-history.jsonl）；该记录无法回看，也无法回滚。";
}

/**
 * 库内部调用点（`deck generate --spec` / `deck regenerate`）的告警出口。
 *
 * 这两处**没有命令面可以回传** `historyWritten`：它们的返回类型是各自的业务结果，
 * 塞一个旁路日志的成败进去会污染契约。但「产生了 false 却没有任何一处渲染它」正是
 * 只写不读的那种缺陷——用户的规格改了、历史里查不到，而屏幕上什么都没说。
 * 所以在这里就地出声，措辞与命令面共用 `formatSpecHistoryWarning` 一个来源。
 */
export function warnSpecHistoryFailure(result: ApplySpecChangeResult): void {
  const warning = formatSpecHistoryWarning(result);
  if (warning !== null) {
    console.error(warning);
  }
}

/**
 * 过时范围预告（`deck spec-apply --dry-run` 的 stdout）。
 *
 * 「确认后 N 页变为已过时」是父任务 design §4.4 的硬要求，不得省略；
 * 这里连一个文件都不写，`--dry-run` 的字面承诺由 `previewSpecChange` 保证。
 */
export function formatSpecChangePreview(
  result: PreviewSpecChangeResult,
): string {
  const { diff } = result;
  const lines = ["预演：不写入任何文件"];
  lines.push(
    `  条目变更: 新增 ${diff.added.length}、删除 ${diff.removed.length}、修改 ${diff.modified.length}`,
  );
  lines.push(`  风格: ${diff.styleChanged ? "已修改" : "未修改"}`);
  if (diff.reordered) {
    // 纯位置变化不改指纹、不让任何页面过时，所以单列一行，免得与「修改」混为一谈
    lines.push("  顺序: 有条目位置调整（不影响过时判定）");
  }
  if (result.willDrift.length === 0 && result.willMiss.length === 0) {
    lines.push("  确认后不会有页面变为已过时或失联");
    return lines.join("\n");
  }
  if (result.willDrift.length > 0) {
    lines.push(
      `  确认后 ${result.willDrift.length} 页变为已过时: ${formatPageList(result.willDrift)}`,
    );
  }
  if (result.willMiss.length > 0) {
    lines.push(
      `  确认后 ${result.willMiss.length} 页规格失联: ${formatPageList(result.willMiss)}`,
    );
  }
  return lines.join("\n");
}

export interface FormatSpecHistoryOptions {
  readonly json?: boolean;
}

/** 变更历史（`deck spec-history` 的 stdout）；记录已由 `listSpecChangeRecords` 倒序 */
export function formatSpecHistory(
  records: readonly SpecChangeRecord[],
  options: FormatSpecHistoryOptions = {},
): string {
  if (options.json === true) {
    return JSON.stringify(records, null, 2);
  }
  if (records.length === 0) {
    return "变更历史：无记录（planning/spec-history.jsonl 不存在或为空）";
  }

  const lines = [`变更历史：${records.length} 条（最近在前）`];
  for (const record of records) {
    lines.push(
      `  ${record.at}  ${ORIGIN_LABELS[record.origin]}  受影响 ${record.fingerprints.length} 条  ${record.recordId}`,
    );
    lines.push(`    ${record.summary}`);
    if (record.rollbackOf !== null) {
      lines.push(`    回滚自 ${record.rollbackOf}`);
    }
  }
  return lines.join("\n");
}
