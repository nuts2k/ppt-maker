/**
 * 人工编辑写回 —— 让「改过」在 text-blocks.json 里留下真实痕迹（design.md §4.1）。
 *
 * PRD F-6：真实工作区 155 个块里 `updatedAt` 非空 0 个、`manual` 来源 0 个，
 * 却全部是 `reviewed`——因为唯一被使用的入口是工具栏「全部标记已复核」，它只推进
 * 状态、不写溯源。于是 report 里的「已复核」无法区分「人工改过」与「一键放行」。
 *
 * 所以这里把两条路径分开，且**只有编辑走溯源**：
 *
 * - `applyManualEdit`：改文本 / 分类 / includeInMask 等，写 `updatedAt` 并同步 manual 来源；
 * - `markBlocksReviewedById`：仅推进 `reviewStatus`，语义是「确认无需改动」，
 *   不写 `updatedAt`、不加 manual 来源。
 *
 * 与 review-status / review-partition 一致：不触碰 `window`，以便同时被 renderer（vite）
 * 与测试（vitest + NodeNext）解析。
 */

import type { TextReviewBlock } from "@ppt-maker/core";

type TextBlockSource = TextReviewBlock["sources"][number];

/** manual 来源的 provider 标识，桌面端复核界面独占 */
export const MANUAL_SOURCE_PROVIDER = "desktop-review";

/**
 * 同步 manual 来源条目：存在则原地替换，不存在则追加。
 *
 * 不能每次按键都往数组里塞一条，那会把 `sources` 撑爆；也不能重排既有条目，
 * `compareBlockSources` 的分区判据依赖 `offline_ocr` / `ai_text_assist` 原样保留。
 *
 * 空文本时移除 manual 条目：`TextBlockSourceSchema.text` 是 `z.string().min(1)`，
 * 而 `TextReviewBlock.text` 允许空串——写入空 text 的条目会在保存时被 zod 拒绝，
 * 表现为「编辑完保存失败」。
 */
function withManualSource(
  sources: readonly TextBlockSource[],
  text: string,
): TextBlockSource[] {
  if (text.length === 0) {
    return sources.filter((source) => source.kind !== "manual");
  }
  const manual: TextBlockSource = {
    kind: "manual",
    provider: MANUAL_SOURCE_PROVIDER,
    text,
    confidence: null,
  };
  const index = sources.findIndex((source) => source.kind === "manual");
  if (index === -1) return [...sources, manual];
  return sources.map((source, i) => (i === index ? manual : source));
}

/**
 * 合并人工编辑并写入溯源。
 *
 * `reviewStatus` 由调用方通过 `patch` 控制，此处不隐式改动——「改了字」和
 * 「确认过了」是两件事，混在一起会让 Enter 之前的中途编辑被误记为已复核。
 * patch 不含 `text` 时（例如只改分类），manual 条目的 text 取合并后的当前文本。
 */
export function applyManualEdit(
  block: TextReviewBlock,
  patch: Partial<TextReviewBlock>,
  now: string,
): TextReviewBlock {
  const merged = { ...block, ...patch };
  return {
    ...merged,
    sources: withManualSource(merged.sources, merged.text),
    updatedAt: now,
  };
}

/**
 * 把指定 id 的未复核块标为已复核，返回新数组与实际改动数。
 *
 * `accepted_with_risk` 不动（它带着 riskAcceptance 记录，语义不同），
 * 与 `markAllBlocksReviewed` 保持同一口径。无改动时返回原数组，避免无谓重渲染。
 */
export function markBlocksReviewedById(
  blocks: readonly TextReviewBlock[],
  blockIds: readonly string[],
): { readonly blocks: readonly TextReviewBlock[]; readonly changed: number } {
  const targets = new Set(blockIds);
  const changed = blocks.filter(
    (block) => targets.has(block.id) && block.reviewStatus === "unreviewed",
  ).length;
  if (changed === 0) return { blocks, changed: 0 };
  return {
    blocks: blocks.map((block) =>
      targets.has(block.id) && block.reviewStatus === "unreviewed"
        ? { ...block, reviewStatus: "reviewed" as const }
        : block,
    ),
    changed,
  };
}

/**
 * 删除指定块，返回新数组与是否真的删掉了。
 *
 * id 不存在时返回原数组：调用方据此决定是否置 dirty，
 * 避免一次无效点击把整页标成「有未保存改动」。
 */
export function deleteBlockById(
  blocks: readonly TextReviewBlock[],
  blockId: string,
): { readonly blocks: readonly TextReviewBlock[]; readonly deleted: boolean } {
  const next = blocks.filter((block) => block.id !== blockId);
  if (next.length === blocks.length) return { blocks, deleted: false };
  return { blocks: next, deleted: true };
}
