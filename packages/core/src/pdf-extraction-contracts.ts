import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";

/**
 * PDF 抽取报告（M5 子任务② 产出，④ 在桌面端呈现）。
 *
 * 放在 core 而不是留在 `apps/cli/src/pdf/report.ts`：renderer 要渲染这份报告，
 * 类型必须经过 `main/ipc/channels.ts`，而 `tsconfig.web.json` 的 `paths` 没有
 * `@cli/*` —— channels.ts 里出现任何 `@cli` 导入都会让 renderer 项目的
 * typecheck 失败。复制一份展示用 DTO 则是两份定义，迟早漂移。
 *
 * **只有类型与 schema 在这里**：落盘（`writeExtractionReport`）、终端格式化
 * （`formatExtractionReport`）与路径约定（`extractionReportRelativePath`）
 * 仍在 CLI —— core 不承担 IO。
 *
 * `schemaVersion` 沿用宿主 `SCHEMA_VERSION`，与 ② 落盘时的写法逐字一致。
 * 报告文件是独立可寻址文件、按〈独立可寻址契约文件的版本轴〉本应有自己的版本轴，
 * 但改它属于行为变更，不在本次纯类型移动的范围内。
 */

/**
 * 结构化跳过原因：桌面端呈现时不必解析自由文本。
 * `page_build_failed` 是渲染成功但建立页面工作区失败——与 `render_failed` 分开，
 * 因为两者的排查方向完全不同（渲染器 vs 工作区/磁盘）。
 */
export const PdfSkipReasonCodeSchema = z.enum([
  "aspect_ratio_mismatch",
  "out_of_range",
  "render_failed",
  "page_build_failed",
]);

export const PdfSkipReasonSchema = z.object({
  code: PdfSkipReasonCodeSchema,
  message: z.string().min(1),
});

export const PdfExtractionCreatedPageSchema = z.object({
  /** PDF 原始页号，不是 deck 内序号 */
  pageNumber: z.number().int().positive(),
  /** deck 内相对路径，如 slides/page-03 */
  workspacePath: z.string().min(1),
  slideId: z.string().min(1),
  widthPt: z.number(),
  heightPt: z.number(),
  renderDpi: z.number(),
  hasExtractableText: z.boolean(),
});

export const PdfExtractionSkippedPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  /** 越界页在文档里根本不存在，没有尺寸可报 */
  widthPt: z.number().nullable(),
  heightPt: z.number().nullable(),
  hasExtractableText: z.boolean().nullable(),
  reason: PdfSkipReasonSchema,
});

export const PdfExtractionReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  documentName: z.string().min(1),
  documentSha256: z.string().min(1),
  extractedAt: z.string().datetime(),
  renderer: z.object({ id: z.string().min(1), version: z.string().min(1) }),
  /** `--pages` 原样，null 表示全部 */
  requestedPages: z.string().nullable(),
  created: z.array(PdfExtractionCreatedPageSchema),
  skipped: z.array(PdfExtractionSkippedPageSchema),
});

export type PdfSkipReasonCode = z.infer<typeof PdfSkipReasonCodeSchema>;
export type PdfSkipReason = z.infer<typeof PdfSkipReasonSchema>;
export type PdfExtractionCreatedPage = z.infer<
  typeof PdfExtractionCreatedPageSchema
>;
export type PdfExtractionSkippedPage = z.infer<
  typeof PdfExtractionSkippedPageSchema
>;
export type PdfExtractionReport = z.infer<typeof PdfExtractionReportSchema>;
