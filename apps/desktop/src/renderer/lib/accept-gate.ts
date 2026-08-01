/**
 * 人工闸门判定 —— 单页视图与待办队列共用的唯一判据来源。
 *
 * 覆盖链路两端的两个耐久闸门：开头的源图确认（`awaitingSourceConfirm`，M5 D6 起
 * 按来源条件性激活）与末尾的最终产物确认（下方全部判据）。中段的文本复核门没有
 * 独立的耐久阶段，判据在 todo-queue 里由 `pendingTextReview` 承担。
 *
 * 链路收敛后（PRD D1）人工停点只剩两个：前段的文本复核门与末尾的最终产物确认。
 * `accept-clean` 不再单独停顿，本文件也随之从「两个验收阶段」收敛为单一闸门。
 *
 * 判定仍然是两层合并，这条教训依旧成立：V1 只认会话层
 * `SessionRunResult.gate === "manual"`，重启后待办队列里的项点进去打不开验收面板——
 * 耐久层明明有 `pptx completed` 而 `accept-pptx` 未完成。因此：
 *
 * - **会话层**：本次 run 刚停在人工闸门（`gate === "manual"`，此后只对应最终确认），
 *   即便耐久层写入时序尚未反映出来也能立即进入确认布局。
 * - **耐久层**：manifest 中 `pptx` 已完成，重启后仍然成立。
 *
 * ## 「页面可达」与「是否待办」是两个判据（2026-07-30 拆分）
 *
 * 此前两者共用 `awaitingFinalConfirm`（`pptx` 完成 **且** `accept-pptx` 未完成）。
 * 验收一写入判据即不成立，最终确认页不再出现，而「重做底图」是页面内的按钮，
 * 随之一起消失——此后界面上没有任何办法重做底图：改文字不触发（`text` 不在
 * `maskInvalidationProjection` 里），改了再改回去更不行（文档与上次保存相同，
 * `decideInvalidation` 直接返回 null），只剩 CLI `slide run --from clean`。
 *
 * | 判据 | 口径 | 用途 |
 * |---|---|---|
 * | `pptxReady` | `pptx` 已完成（不看 accept 状态） | 确认页可达：工具栏「最终确认」档是否出现 |
 * | `awaitingFinalConfirm` | `pptxReady` 且未 `finalAccepted` | 待办队列项，已验收页不得重列为待办 |
 *
 * 两者仍由同一组原子判据合成（`pptxReady` / `finalAccepted`），不得在消费方就地
 * 再写一份 filter——「同一件事在多处展示，它们是同一个函数算出来的吗」，不是的话
 * 迟早各说各话，本文件的注释里就记着一次。
 *
 * 与 stage-view / todo-queue 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node，NodeNext）解析。
 */

import type { SlideDetail } from "../../main/ipc/channels.js";
import type { RunStage } from "../../shared/stages.js";
import type { SessionRunResult } from "../stores/run-types.js";

/** 闸门来源：会话层（本次 run 停在此）/ 耐久层（manifest 推导） */
export type FinalGateSource = "session" | "durable";

export interface FinalGate {
  readonly source: FinalGateSource;
  /**
   * 该页的最终确认**已经完成**。
   *
   * 闸门非 null 只表示「确认页可进」，不表示「还没验收」。已验收页进来是为了看
   * 结果或重做底图，界面据此改为呈现已验收状态而非一个看着还能按的「完成」。
   */
  readonly accepted: boolean;
}

/** DeckRunner 停在人工闸门时给出的 gate 标识（收敛后只对应最终确认） */
const MANUAL_GATE = "manual";

export function stageStatusOf(
  slide: Pick<SlideDetail, "stages">,
  stage: RunStage,
): string | undefined {
  return slide.stages.find((detail) => detail.stage === stage)?.status;
}

/**
 * 该页仍欠一次源图确认（纯耐久层判据）。
 *
 * `accept-source` 对 `imported` / `extracted` 在建立工作区或换源时就被自动放行为
 * `completed`（不写 accepted.json，事实记在 attempt 上），因此这条判据只会在
 * `generated` 页上成立——消费方不必也不得自己去看 `source.kind`。
 *
 * **必须取耐久层，不能取会话层的 `gate === "source"`**：run 停在源图确认时会话层
 * 确实带着这个 gate，但它只活在本次进程里。2026-08-01 真机走查实测——刷新之后
 * 这一页从待办队列与「待处理」筛选里一起消失，只剩活动日志里一行默认折叠的记录，
 * 界面上再无任何线索说明它为什么不往下走。
 *
 * 判据写成「非 completed」而不是「pending」：显式失效（阶段轨道上点这个节点重跑）
 * 会把它置为 `stale`，那同样是一次欠着的人工确认。
 *
 * 阶段整个缺失是**状态未知**（已移除的页、manifest 读不出来的页在 `deck.ts` 里
 * 拿到的都是 `stages: []`），不是「欠一次确认」——对一个连工作区都加载不了的页
 * 说「去确认源图」是假信息，那页真正的问题写在 `lastError` 里。
 */
export function awaitingSourceConfirm(
  slide: Pick<SlideDetail, "stages">,
): boolean {
  const status = stageStatusOf(slide, "accept-source");
  return status !== undefined && status !== "completed";
}

/** PPTX 已产出：最终确认页有内容可看，与是否已验收无关（纯耐久层判据） */
export function pptxReady(slide: Pick<SlideDetail, "stages">): boolean {
  return stageStatusOf(slide, "pptx") === "completed";
}

/** 最终确认已写入（纯耐久层判据） */
export function finalAccepted(slide: Pick<SlideDetail, "stages">): boolean {
  return stageStatusOf(slide, "accept-pptx") === "completed";
}

/** PPTX 已产出但最终确认尚未完成 —— **待办队列口径**，已验收页不在其中 */
export function awaitingFinalConfirm(
  slide: Pick<SlideDetail, "stages">,
): boolean {
  return pptxReady(slide) && !finalAccepted(slide);
}

/**
 * 该页的最终确认页是否可达；null 表示 PPTX 还没产出，页面无内容可呈现。
 *
 * 会话层优先——它精确表达「这一轮就停在这里」，即便耐久层写入时序尚未反映。
 * `accepted` 一律取耐久层：它是验收有没有落盘的唯一事实，会话层不表达这件事。
 */
export function deriveFinalGate(
  slide: Pick<SlideDetail, "stages">,
  sessionResult: SessionRunResult | undefined,
): FinalGate | null {
  const accepted = finalAccepted(slide);
  if (sessionResult?.gate === MANUAL_GATE) {
    return { source: "session", accepted };
  }
  return pptxReady(slide) ? { source: "durable", accepted } : null;
}
