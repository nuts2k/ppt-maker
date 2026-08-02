/**
 * PDF 抽取报告的展示口径 —— 完成面板与活动日志回溯共用同一份格式化。
 *
 * 两条规则：
 *
 * 1. **原因文案一律取报告里的 `reason.message`**，桌面端不重拼。子任务② 落盘时已经
 *    写好带具体数值的完整中文句（「页面宽高比 …，偏离 16:9 超出容差」「PDF 只有 N 页，
 *    不存在第 M 页」）。同一句话在 CLI 与桌面端各写一份必然漂移，而且是静默漂移——
 *    两边都不会报错，只是说法慢慢对不上。`reason.code` **只用于分组**。
 * 2. **跳过不上校对红**。混合宽高比的 PDF 里跳掉非 16:9 页是抽取的**设计内结果**，
 *    不是故障；命令也没有失败，其余页照常建立。按 DESIGN.md「有颜色 = 要你管」，
 *    这类常态必须安静，走中性色。
 *
 *    唯二例外是 `render_failed` / `page_build_failed`：它们不是「按规矩跳过」，而是
 *    「本该能出、结果没出」，用户确实需要再看一眼（重跑一次或换页码范围）。给它们一档
 *    `state-stale`：不用 `proof`（校对红是全屏唯一高饱和色，只标「差异」与「待我处理」，
 *    用在一份看完就关的报告里会喧宾夺主），也不用 `state-failed`（整条抽取命令并没有
 *    失败）。`state-stale` 的语义「有东西没跟上，需要你再看一眼」最贴近。
 *
 * 与 source-view / stage-view 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node，NodeNext）解析。
 */

import type {
  PdfExtractionCreatedPage,
  PdfExtractionReport,
  PdfExtractionSkippedPage,
  PdfSkipReasonCode,
} from "@ppt-maker/core";

/** 跳过分组的视觉档位。含义与取舍见文件头第 2 条。 */
export type SkipTone = "neutral" | "stale";

/**
 * 分组标题用的短词。
 *
 * 这**不是**在重拼原因文案：每条跳过页的正文仍逐字取自 `reason.message`，
 * 这里只是把同类归到一起时那一行标题。分组本来就只能由 `code` 派生。
 */
export const SKIP_REASON_LABELS: Readonly<Record<PdfSkipReasonCode, string>> = {
  aspect_ratio_mismatch: "宽高比不是 16:9",
  out_of_range: "页码超出文档范围",
  render_failed: "渲染失败",
  page_build_failed: "建立页面失败",
};

/**
 * 分组顺序固定，不随报告里的出现次序变。
 * 设计内的跳过排在前，异常排在后——异常留在末尾更容易被看见。
 */
const SKIP_REASON_ORDER: readonly PdfSkipReasonCode[] = [
  "aspect_ratio_mismatch",
  "out_of_range",
  "render_failed",
  "page_build_failed",
];

/** 只有这两类是「本该能出、结果没出」，其余是按规矩跳过 */
const UNEXPECTED_SKIPS: ReadonlySet<PdfSkipReasonCode> = new Set([
  "render_failed",
  "page_build_failed",
]);

export function skipTone(code: PdfSkipReasonCode): SkipTone {
  return UNEXPECTED_SKIPS.has(code) ? "stale" : "neutral";
}

export interface ExtractionSummary {
  readonly documentName: string;
  readonly createdCount: number;
  readonly skippedCount: number;
  /** 「全部页」或 `--pages` 原样回显 */
  readonly requestedPagesText: string;
  /** 渲染器 id + 版本，可复现性锚点（同一页重抽能对得上） */
  readonly rendererText: string;
}

export function summarizeExtraction(
  report: PdfExtractionReport,
): ExtractionSummary {
  return {
    documentName: report.documentName,
    createdCount: report.created.length,
    skippedCount: report.skipped.length,
    requestedPagesText:
      report.requestedPages === null
        ? "全部页"
        : `第 ${report.requestedPages} 页`,
    rendererText: `${report.renderer.id} ${report.renderer.version}`,
  };
}

export interface ExtractionLine {
  /** PDF 原始页号，同时用作列表 key（一份报告里不会重复） */
  readonly pageNumber: number;
  readonly text: string;
}

export interface SkipGroup {
  readonly code: PdfSkipReasonCode;
  readonly label: string;
  readonly tone: SkipTone;
  readonly lines: readonly ExtractionLine[];
}

/**
 * 建立页一行：`第 3 页 → page-03 · 1224×792 pt · 含可提取文本层`。
 *
 * `hasExtractableText` 在这里只是抽取当时的观测值。页级的权威来源是每页
 * `manifest.source`（重抽后也不会失真），页面详情走那条，不靠这份报告。
 */
export function formatCreatedPage(page: PdfExtractionCreatedPage): string {
  const label = page.workspacePath.split("/").filter(Boolean).at(-1) ?? "";
  return [
    `第 ${page.pageNumber} 页 → ${label}`,
    `${formatPt(page.widthPt)}×${formatPt(page.heightPt)} pt`,
    page.hasExtractableText ? "含可提取文本层" : "无可提取文本层",
  ].join(" · ");
}

/**
 * 跳过页一行：`第 7 页 · 1224×792 pt · <reason.message 原文>`。
 *
 * 越界页在文档里根本不存在，没有尺寸可报，此时写「尺寸未知」——与 CLI 终端格式化
 * 同一措辞。**不要**在这里编造一个 0×0。
 */
export function formatSkippedPage(page: PdfExtractionSkippedPage): string {
  const size =
    page.widthPt === null || page.heightPt === null
      ? "尺寸未知"
      : `${formatPt(page.widthPt)}×${formatPt(page.heightPt)} pt`;
  return `第 ${page.pageNumber} 页 · ${size} · ${page.reason.message}`;
}

/** 按 `reason.code` 分组；空组不产出，因此没有跳过页时返回空数组 */
export function groupSkippedPages(
  pages: readonly PdfExtractionSkippedPage[],
): readonly SkipGroup[] {
  const groups: SkipGroup[] = [];
  for (const code of SKIP_REASON_ORDER) {
    const lines = pages
      .filter((page) => page.reason.code === code)
      .map((page) => ({
        pageNumber: page.pageNumber,
        text: formatSkippedPage(page),
      }));
    if (lines.length === 0) continue;
    groups.push({
      code,
      label: SKIP_REASON_LABELS[code],
      tone: skipTone(code),
      lines,
    });
  }
  return groups;
}

/** 建立页逐行，顺序即报告顺序（抽取本就按页号升序写入） */
export function createdLines(
  report: PdfExtractionReport,
): readonly ExtractionLine[] {
  return report.created.map((page) => ({
    pageNumber: page.pageNumber,
    text: formatCreatedPage(page),
  }));
}

/**
 * pt 尺寸：整数原样，非整数保留一位小数。
 * PDF 的点尺寸常带小数尾巴（595.276），全量打出来会把一行挤爆。
 */
function formatPt(value: number): string {
  if (!Number.isFinite(value)) return "?";
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}
