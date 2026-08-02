/**
 * 页面来源与规格漂移的展示口径 —— 卡片、审片视图与将来任何要显示这两件事的地方
 * 一律调这里，不各写一份文案。
 *
 * 两条规则来自 DESIGN.md 与本任务 design.md §6：
 *
 * 1. **来源不上色**。它是常态信息（每一页都有来源），不是「要你管」。给常态上色
 *    就是旧版 9 个绿点的同一个错误——一屏扫过去，有颜色的地方必须仍然只是
 *    需要动作的地方。
 * 2. **漂移只是标注**。`drifted` / `missing` 用 `state-stale`（语义正是「上游已变更」），
 *    但它**不进待办队列、不影响任何阶段状态、不让卡片状态点变色**：规格是纯派生，
 *    改回原样自动消失，没有任何东西需要重跑才能复位。
 *
 * 与 stage-view / accept-gate 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node，NodeNext）解析。
 */

import type { SlideSourceKind, SpecDriftStatus } from "@ppt-maker/core";

/** 三档来源的中文短词。移除页没有来源（CLI 不加载其工作区），不在此表内 */
export const SOURCE_KIND_LABELS: Readonly<Record<SlideSourceKind, string>> = {
  imported: "导入",
  extracted: "抽取",
  generated: "生成",
};

/**
 * 卡片缩略图角上的来源徽标文字；null 表示不显示徽标。
 *
 * 移除页 `sourceKind` 为 null（CLI 不加载已移除页的工作区），此时不显示——
 * 那个角位归「已移除」徽标，两者互斥。
 */
export function sourceBadgeLabel(
  sourceKind: SlideSourceKind | null,
): string | null {
  return sourceKind === null ? null : SOURCE_KIND_LABELS[sourceKind];
}

/**
 * 规格漂移的详情行文案；null 表示无需标注（不适用或已同步）。
 *
 * 措辞刻意不含「失败」：漂移是「改了规格、图还没跟上」的常规状态，
 * 与 stale 同一条措辞约定（`stale` 不是 `failed`）。
 */
export function specDriftText(drift: SpecDriftStatus | null): string | null {
  switch (drift) {
    case "drifted":
      return "规格已更新";
    case "missing":
      return "规格条目已失联";
    default:
      return null;
  }
}
