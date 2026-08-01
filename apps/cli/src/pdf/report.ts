import type { SCHEMA_VERSION } from "@ppt-maker/core";
import { writeJsonAtomic } from "../slide/workspace.js";

/**
 * 抽取报告：每次 `deck extract` 一份、不覆盖，落在 deck 级约定目录
 * `<deck>/extractions/`。
 *
 * 不进 `DeckManifest`：会让 manifest 同时承担第二种职责，且报告文件缺失时
 * manifest 会变成指向不存在文件的悬空引用。约定目录没有这个问题——readdir 一次即知。
 */
export const EXTRACTIONS_DIRECTORY = "extractions";

/**
 * 结构化跳过原因：子任务④ 在桌面端呈现时不必解析自由文本。
 * `page_build_failed` 是渲染成功但建立页面工作区失败——与 `render_failed` 分开，
 * 因为两者的排查方向完全不同（渲染器 vs 工作区/磁盘）。
 */
export type PdfSkipReasonCode =
  | "aspect_ratio_mismatch"
  | "out_of_range"
  | "render_failed"
  | "page_build_failed";

export interface PdfSkipReason {
  readonly code: PdfSkipReasonCode;
  readonly message: string;
}

export interface PdfExtractionCreatedPage {
  /** PDF 原始页号，不是 deck 内序号 */
  readonly pageNumber: number;
  /** deck 内相对路径，如 slides/page-03 */
  readonly workspacePath: string;
  readonly slideId: string;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly renderDpi: number;
  readonly hasExtractableText: boolean;
}

export interface PdfExtractionSkippedPage {
  readonly pageNumber: number;
  /** 越界页在文档里根本不存在，没有尺寸可报 */
  readonly widthPt: number | null;
  readonly heightPt: number | null;
  readonly hasExtractableText: boolean | null;
  readonly reason: PdfSkipReason;
}

export interface PdfExtractionReport {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly documentName: string;
  readonly documentSha256: string;
  readonly extractedAt: string;
  readonly renderer: { readonly id: string; readonly version: string };
  /** `--pages` 原样，null 表示全部 */
  readonly requestedPages: string | null;
  readonly created: readonly PdfExtractionCreatedPage[];
  readonly skipped: readonly PdfExtractionSkippedPage[];
}

/**
 * ISO 时间戳里的 `:` 与 `.` 换成 `-`：`:` 在 Finder 里会被显示成 `/`。
 * 精确时间仍在 JSON 的 `extractedAt` 里，文件名只负责排序与唯一。
 */
export function extractionReportRelativePath(
  extractedAt: string,
  documentSha256: string,
): string {
  const stamp = extractedAt.replace(/[:.]/g, "-");
  return `${EXTRACTIONS_DIRECTORY}/${stamp}-${documentSha256.slice(0, 8)}.json`;
}

export async function writeExtractionReport(
  absolutePath: string,
  report: PdfExtractionReport,
): Promise<void> {
  await writeJsonAtomic(absolutePath, report);
}

export function formatExtractionReport(report: PdfExtractionReport): string {
  const lines: string[] = [
    `PDF：${report.documentName}（${report.documentSha256.slice(0, 12)}）`,
    `渲染器：${report.renderer.id} ${report.renderer.version}`,
    `建立 ${report.created.length} 页，跳过 ${report.skipped.length} 页`,
  ];
  for (const page of report.created) {
    lines.push(
      `  建立 第 ${page.pageNumber} 页 → ${page.workspacePath}（${page.widthPt} × ${page.heightPt} pt，${page.renderDpi} DPI，${
        page.hasExtractableText ? "含可提取文本层" : "无可提取文本层"
      }）`,
    );
  }
  for (const page of report.skipped) {
    const size =
      page.widthPt === null || page.heightPt === null
        ? "尺寸未知"
        : `${page.widthPt} × ${page.heightPt} pt`;
    lines.push(
      `  跳过 第 ${page.pageNumber} 页（${size}）：${page.reason.message} [${page.reason.code}]`,
    );
  }
  return lines.join("\n");
}
