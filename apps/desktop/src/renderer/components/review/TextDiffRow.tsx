import { compareBlockSources, type TextReviewBlock } from "@ppt-maker/core";
import { useMemo } from "react";
import {
  type DiffSegment,
  diffChars,
  shouldFallbackToSideBySide,
} from "@/lib/text-diff";
import { cn } from "@/lib/utils";
import { BlockTextEditor } from "./BlockTextEditor";

/**
 * 「文字待确认」项：并排呈现 offline_ocr 原文与 ai_text_assist 文本，逐字高亮差异。
 *
 * 复核的真实工作量是双源分歧（PRD F-9：57%/58% 的版式文字两个来源不一致），
 * 目标是「每项能直接读出差异位置，不需要去画布上找这块字」。
 *
 * ## 行结构取舍（两行，第二行随当前项在只读与可编辑之间切换）
 *
 * 差异有两侧：OCR 多出的字（`ocr-only`）与 AI 多出的字（`assist-only`）。
 * 只在 OCR 行高亮会漏掉 AI 侧的增补，所以两侧都要能看到高亮；而 textarea 内部
 * 无法着色，于是：
 *
 * - 第一行恒为 OCR 原文，高亮 `ocr-only` 段；
 * - 第二行在非当前项时是只读的 AI 文本（高亮 `assist-only` 段），在当前项时换成
 *   可编辑 textarea——编辑只会发生在当前项，而此时 OCR 行的高亮仍在上方可对照。
 *
 * 没有采用「OCR 高亮 + AI 高亮 + textarea」三行：未编辑时 AI 高亮行与 textarea
 * 内容完全重复，45 项列表里徒增一倍高度，反而更难扫读。
 *
 * ## 两列网格：让两侧文字**逐字对齐**
 *
 * 两行改用固定标签列 + 等内边距的文本格，因此上下两行的第 n 个字在屏幕上落在
 * 同一横向位置——差异在哪个字，眼睛垂直一扫即可确认，不必来回找。上一版两行的
 * 左内边距不同（只读段落 px-2、textarea 另一套），字始终错开半个字宽。
 *
 * 人工改过之后 `block.text` 不再等于 assist 文本，此时按 assist 的分段着色会错位到
 * 相邻字上，因此只读行退回纯文本并打「已编辑」标记。
 */

interface TextDiffRowProps {
  readonly block: TextReviewBlock;
  /** 当前复核项：接管键盘焦点并切换为可编辑 textarea */
  readonly isCurrent: boolean;
  readonly onUpdateBlock: (
    blockId: string,
    patch: Partial<TextReviewBlock>,
  ) => void;
}

/** 行首来源标签，`badge` 档（11px / 600）。右对齐让它紧贴文本列 */
const SOURCE_LABEL =
  "pt-1.5 text-right text-2xs font-semibold text-ink-muted select-none";

/**
 * 文本格：与 `BlockTextEditor` 的 textarea 同内边距同边框宽度（边框透明），
 * 两行的字符网格因此严格对齐。
 */
const TEXT_CELL =
  "min-w-0 whitespace-pre-wrap break-words rounded-sm border border-transparent px-2.5 py-1.5 text-sm leading-relaxed";

/**
 * 差异段：`proof-wash` 作底、`proof` 作字。
 *
 * 这是校对红唯一的正当用途之一——它标的就是「差异」（DESIGN.md `校对红`）。
 * 上一版用的是营销站签名色 coral，属于把品牌色挪用为语义色。
 */
const DIFF_MARK = "rounded-xs bg-proof-wash px-0.5 font-medium text-proof";

export function TextDiffRow({
  block,
  isCurrent,
  onUpdateBlock,
}: TextDiffRowProps): React.JSX.Element {
  const sources = useMemo(() => compareBlockSources(block), [block]);
  const { ocr, assist } = sources;

  // 缺任一来源时不存在可比对的两侧，diff 直接跳过
  const segments = useMemo<readonly DiffSegment[]>(
    () => (ocr === null || assist === null ? [] : diffChars(ocr, assist)),
    [ocr, assist],
  );
  const fallback =
    ocr !== null && assist !== null && shouldFallbackToSideBySide(ocr, assist);

  // 人工编辑后 assist 分段无法与当前文本对齐，只读行退回纯文本
  const edited = assist !== null && block.text !== assist;

  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1">
      <span className={SOURCE_LABEL}>OCR</span>
      {ocr === null ? (
        <span className={cn(TEXT_CELL, "text-ink-muted")}>无离线 OCR 候选</span>
      ) : (
        // 只读来源垫一层 surface：与下方可编辑行区分「哪一行改得动」
        <p className={cn(TEXT_CELL, "bg-surface text-ink-secondary")}>
          {fallback ? (
            ocr
          ) : (
            <DiffText segments={segments} side="ocr" plain={ocr} />
          )}
        </p>
      )}

      <span className={SOURCE_LABEL}>{edited ? "人工" : "AI"}</span>
      {isCurrent ? (
        <BlockTextEditor
          block={block}
          onUpdateBlock={onUpdateBlock}
          autoFocus
        />
      ) : (
        <p className={cn(TEXT_CELL, "text-ink")}>
          {edited || fallback || assist === null ? (
            block.text
          ) : (
            <DiffText segments={segments} side="assist" plain={assist} />
          )}
        </p>
      )}

      {/* 降级要说出来：不提示的话，一段真有差异的长文本看起来就是「两边都没标红」 */}
      {fallback && (
        <p className="col-start-2 text-2xs text-ink-muted">
          文本过长，已改为整段并列，不逐字标差异
        </p>
      )}
    </div>
  );
}

/**
 * 按 diff 分段着色。
 *
 * `same + ocr-only` 拼回等于 OCR 原文、`same + assist-only` 拼回等于 assist 文本
 * （`text-diff.ts` 的不变量），因此各侧只渲染属于自己的分段，文本不会缺字。
 */
function DiffText({
  segments,
  side,
  plain,
}: {
  readonly segments: readonly DiffSegment[];
  readonly side: "ocr" | "assist";
  readonly plain: string;
}): React.JSX.Element {
  const own = side === "ocr" ? "ocr-only" : "assist-only";
  // 分段无 id，用它在本侧文本中的起始字符偏移作身份：同一段文本下偏移唯一且稳定
  let offset = 0;
  const visible: ReadonlyArray<{
    readonly segment: DiffSegment;
    readonly key: string;
  }> = segments
    .filter((segment) => segment.kind === "same" || segment.kind === own)
    .map((segment) => {
      const key = `${side}-${offset}-${segment.kind}`;
      offset += segment.text.length;
      return { segment, key };
    });
  if (visible.length === 0) return <>{plain}</>;
  return (
    <>
      {visible.map(({ segment, key }) => (
        <span key={key} className={cn(segment.kind === own && DIFF_MARK)}>
          {segment.text}
        </span>
      ))}
    </>
  );
}
