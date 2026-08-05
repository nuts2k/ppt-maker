/**
 * 控制台零页空态的指路文案（R7）。
 *
 * 与 stage-view / source-view 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node，NodeNext）解析——
 * 本项目没有 DOM 测试库，规则只能测在纯函数产物上。
 *
 * 待建条数**不在这里算**：口径的唯一实现是 `planning-core` 的
 * `classifyPendingEntries`（它与 CLI `collectGeneratedPages` 的两道过滤逐条对齐）。
 * 这里只负责「读不到规格时怎么办」与「拿到的数字怎么说给用户听」。
 */

import type { ContentSpec } from "@ppt-maker/core";
import type { SlideDetail } from "../../main/ipc/channels.js";
import { classifyPendingEntries } from "./planning-core.js";

/** 读到的规格连同它属于哪个 deck 一起存 —— 见 `specForDeck` */
export interface DeckSpecSnapshot {
  readonly deckPath: string;
  /** 该 deck 的规格；deck 没有规格或这次没读成时为 null */
  readonly spec: ContentSpec | null;
}

export interface ConsoleEmptyDeckCopy {
  readonly title: string;
  readonly body: string;
  /** 指向策划工作台的动作；无待建条目时为 null（空态不摆一个没用的按钮） */
  readonly actionLabel: string | null;
}

/** 无规格 / 读不到规格时的兜底文案，与本任务改动前逐字相同 */
const FALLBACK_BODY = "用右上角「添加页面」从图片、PDF 或内容规格加进来。";

/**
 * 读 deck 内规格；**读失败一律返回 `null`，绝不抛**。
 *
 * 于是「没有规格」（IPC 如实返回 `null`）与「这次没读成」折成同一种结局——
 * 空态对两者的应对完全相同。这属于《静默失败诊断指南》里**该静默**的一类，
 * 判据是：*这个静默有没有藏起一次本该发生的写入、状态变化或付费调用？* 这里三样
 * 都没有，唯一的产物就是下面那段文案，退回兜底后界面依然自洽、用户的下一步一个
 * 不少（从图片 / PDF 添加页面根本不依赖规格读得出来）。反例是建页与保存规格那类：
 * 吞掉一次失败，用户会以为事情已经做成。
 *
 * 读取器由调用方注入，本函数因此不碰 `window`，失败路径可以被直接测到。
 */
export async function probeDeckSpec(
  readDeckSpec: () => Promise<ContentSpec | null>,
): Promise<ContentSpec | null> {
  try {
    return await readDeckSpec();
  } catch {
    return null;
  }
}

/**
 * 快照属于当前 deck 才作数，否则一律当作「还不知道」（`null`）。
 *
 * 在途请求由调用侧的 cleanup 作废，但那只挡住**迟到的写入**，挡不住**已经写在
 * state 里的上一个 deck 的值**：切 deck 时 deckPath 与 slides 同一次 `set` 落地
 * （`deck-store.openDeck`），而重读规格的 effect 要等这一帧渲染完才跑，中间那一帧
 * 会拿 A 的规格配 B 的页去算条数——用户看到的是「B 里有 6 条待建」，而 B 可能连
 * 规格都没有。把归属做进数据本身，这一帧就不存在了，不靠时序去追。
 */
export function specForDeck(
  snapshot: DeckSpecSnapshot | null,
  deckPath: string | null,
): ContentSpec | null {
  if (snapshot === null || deckPath === null) return null;
  return snapshot.deckPath === deckPath ? snapshot.spec : null;
}

/** 待建条数；规格读不到时为 `null`，与「规格在但一条都不待建」（0）区分开 */
export function pendingSpecCount(
  spec: ContentSpec | null,
  slides: readonly SlideDetail[],
): number | null {
  if (spec === null) return null;
  return classifyPendingEntries(spec, slides).length;
}

/**
 * 零页 deck 的空态说什么。
 *
 * `null`（读不到规格）与 0（规格在但没有一条可建）都退回兜底文案：后者若照样
 * 指向策划工作台，用户点过去会发现那里空空如也——空态的职责是说明下一步能干
 * 什么，指一条死路比不指更糟。
 */
export function buildEmptyDeckCopy(
  pendingCount: number | null,
): ConsoleEmptyDeckCopy {
  const title = "当前 Deck 还没有任何页面";
  if (pendingCount === null || pendingCount <= 0) {
    return { title, body: FALLBACK_BODY, actionLabel: null };
  }
  return {
    title,
    body: `内容规格里有 ${pendingCount} 条还没建页。到策划工作台勾选要建的条目，再发起建页。`,
    actionLabel: "去策划工作台",
  };
}
