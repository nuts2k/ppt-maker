/**
 * 字符级 diff —— 「文字待确认」项高亮 OCR 原文与 AI 文本的差异位置（design.md §4.1）。
 *
 * 双源分歧多为 1–3 字（PRD F-9：`象衽鲍洁高雅、连锦不绝，` → `象征洁净高雅、连绵不绝，`），
 * 整行并排读不出差在哪个字，所以按字符高亮。
 *
 * **不变量**：`same + ocr-only` 分段按序拼回等于 OCR 原文，`same + assist-only`
 * 拼回等于 assist 文本。任何实现变动都必须保持这一点，否则高亮会错位到相邻字上。
 *
 * 与 review-partition 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + NodeNext）解析。
 */

export type DiffKind = "same" | "ocr-only" | "assist-only";

export interface DiffSegment {
  readonly kind: DiffKind;
  readonly text: string;
}

/**
 * 超长文本回退阈值：任一侧字符数超过它就不做 LCS。
 *
 * LCS 是 O(n·m)，复核列表要在每次按键后重渲染当前项，长文本会直接卡住输入。
 */
export const DIFF_LCS_MAX_CHARS = 400;

/** true 表示界面应回退为「整行并排」而非逐字高亮（C4 的降级路径） */
export function shouldFallbackToSideBySide(
  ocr: string,
  assist: string,
): boolean {
  return (
    Array.from(ocr).length > DIFF_LCS_MAX_CHARS ||
    Array.from(assist).length > DIFF_LCS_MAX_CHARS
  );
}

/**
 * 字符级 LCS diff，返回按原文顺序排列的连续分段。
 *
 * 相邻同类分段合并，界面上一段差异只产生一个高亮块，而不是逐字符一块。
 * 超长输入按 `DIFF_LCS_MAX_CHARS` 回退为整段粗粒度分段。
 */
export function diffChars(ocr: string, assist: string): readonly DiffSegment[] {
  if (shouldFallbackToSideBySide(ocr, assist)) {
    return coarseSegments(ocr, assist);
  }

  // 按码点切分，避免把代理对（emoji 等）拆成孤立半个字符
  const left = Array.from(ocr);
  const right = Array.from(assist);
  const rows = left.length + 1;
  const columns = right.length + 1;

  // lcs[i][j] = left[i..] 与 right[j..] 的最长公共子序列长度（后缀表，便于正向回溯）
  const lcs = new Int32Array(rows * columns);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lcs[i * columns + j] =
        left[i] === right[j]
          ? (lcs[(i + 1) * columns + (j + 1)] ?? 0) + 1
          : Math.max(
              lcs[(i + 1) * columns + j] ?? 0,
              lcs[i * columns + (j + 1)] ?? 0,
            );
    }
  }

  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      append(segments, "same", left[i] ?? "");
      i += 1;
      j += 1;
    } else if (
      (lcs[(i + 1) * columns + j] ?? 0) >= (lcs[i * columns + (j + 1)] ?? 0)
    ) {
      append(segments, "ocr-only", left[i] ?? "");
      i += 1;
    } else {
      append(segments, "assist-only", right[j] ?? "");
      j += 1;
    }
  }
  if (i < left.length) append(segments, "ocr-only", left.slice(i).join(""));
  if (j < right.length)
    append(segments, "assist-only", right.slice(j).join(""));
  return segments;
}

/** 相邻同类合并：直接追加到上一段，保证一段差异只对应一个高亮块 */
function append(segments: DiffSegment[], kind: DiffKind, text: string): void {
  if (text === "") return;
  const last = segments[segments.length - 1];
  if (last?.kind === kind) {
    segments[segments.length - 1] = { kind, text: last.text + text };
    return;
  }
  segments.push({ kind, text });
}

/** 超长回退：整段两分，不定位到具体字符 */
function coarseSegments(ocr: string, assist: string): readonly DiffSegment[] {
  if (ocr === assist) {
    return ocr === "" ? [] : [{ kind: "same", text: ocr }];
  }
  const segments: DiffSegment[] = [];
  append(segments, "ocr-only", ocr);
  append(segments, "assist-only", assist);
  return segments;
}
