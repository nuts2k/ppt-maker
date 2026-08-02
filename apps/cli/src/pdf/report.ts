import type { PdfExtractionReport } from "@ppt-maker/core";
import { writeJsonAtomic } from "../slide/workspace.js";

/**
 * 抽取报告的落盘与终端格式化。
 *
 * **类型与 zod schema 已移入 core**（`pdf-extraction-contracts.ts`）：桌面端要渲染
 * 这份报告，类型必须经过 `main/ipc/channels.ts`，而那里引不到 `@cli/*`。
 * 这里留 IO 与路径约定 —— core 不承担 IO。下面的 re-export 是过渡，
 * 现有 CLI 侧 import 无需改动。
 */
export type {
  PdfExtractionCreatedPage,
  PdfExtractionReport,
  PdfExtractionSkippedPage,
  PdfSkipReason,
  PdfSkipReasonCode,
} from "@ppt-maker/core";

/**
 * 每次 `deck extract` 一份、不覆盖，落在 deck 级约定目录 `<deck>/extractions/`。
 *
 * 不进 `DeckManifest`：会让 manifest 同时承担第二种职责，且报告文件缺失时
 * manifest 会变成指向不存在文件的悬空引用。约定目录没有这个问题——readdir 一次即知。
 */
export const EXTRACTIONS_DIRECTORY = "extractions";

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
