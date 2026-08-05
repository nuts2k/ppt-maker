import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  type ExtractedSource,
  FoundationError,
  PdfExtractionReportSchema,
  validateWideAspectRatio,
} from "@ppt-maker/core";
import {
  createEmptyDeckWorkspace,
  loadDeckWorkspace,
  resolveDeckPath,
} from "../deck/workspace.js";
import { sha256File } from "../slide/workspace.js";
import { appendSlideWithSource } from "./deck-append.js";
import { parsePageSelection } from "./pages.js";
import {
  defaultPdfRenderBinary,
  type PdfProbePage,
  probePdfDocument,
  renderPdfPages,
} from "./render-binary.js";
import {
  extractionReportRelativePath,
  type PdfExtractionCreatedPage,
  type PdfExtractionReport,
  type PdfExtractionSkippedPage,
  writeExtractionReport,
} from "./report.js";

/**
 * F3：固定目标宽度，而不是固定 DPI。
 *
 * 按固定 DPI 渲染会让混合了不同页面尺寸的 PDF 产出像素数差一截的图；固定宽度让每页
 * 分辨率可预期，且与 clean plate 的 2048 档位对齐。PDF 是矢量，小尺寸页放大不失真。
 */
export const PDF_RENDER_TARGET_WIDTH = 2048;

export interface ExtractPdfToDeckOptions {
  readonly pdfPath: string;
  readonly deckPath: string;
  /** `--pages` 原样，如 `3-8,12`；缺省表示全部 */
  readonly pages?: string;
  readonly binaryPath?: string;
  readonly deckName?: string;
  readonly onProgress?: (message: string) => void;
}

export interface ExtractPdfToDeckResult {
  readonly deckPath: string;
  readonly deckCreated: boolean;
  readonly reportPath: string;
  readonly report: PdfExtractionReport;
}

export interface ExtractionFailureDetails {
  /** 报告落盘的绝对路径；新建 deck 一页没建成时整个丢弃，此时为 null */
  readonly reportPath: string | null;
  readonly report: PdfExtractionReport;
}

/**
 * 从「一页都没建成」的失败里取回抽取报告与它的落盘路径；不是这类失败则为 null。
 *
 * CLI 的终端打印与桌面端的活动日志都走这一个读取点：`details` 的形状是内部约定，
 * 两侧各写一次 `as { report?: … }` 就是同一份契约的两个私有副本。
 */
export function extractionFailureDetails(
  error: unknown,
): ExtractionFailureDetails | null {
  if (!(error instanceof FoundationError) || error.details === undefined) {
    return null;
  }
  const parsed = PdfExtractionReportSchema.safeParse(error.details.report);
  if (!parsed.success) {
    return null;
  }
  const reportPath = error.details.reportPath;
  return {
    reportPath: typeof reportPath === "string" ? reportPath : null,
    report: parsed.data,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function aspectRatioSkip(page: PdfProbePage): PdfExtractionSkippedPage {
  const base = {
    pageNumber: page.pageNumber,
    widthPt: page.widthPt,
    heightPt: page.heightPt,
    hasExtractableText: page.hasExtractableText,
  };
  if (page.widthPt <= 0 || page.heightPt <= 0) {
    return {
      ...base,
      reason: {
        code: "aspect_ratio_mismatch",
        message: `页面尺寸 ${page.widthPt} × ${page.heightPt} pt 不是有效的正数`,
      },
    };
  }
  // 判定用 PDF 页原始尺寸，不是渲染后的像素——渲染宽度被固定成 2048，比例信息已丢。
  // 容差单点来自 core，Swift 侧不做任何判定。
  const validation = validateWideAspectRatio({
    width: page.widthPt,
    height: page.heightPt,
  });
  return {
    ...base,
    reason: {
      code: "aspect_ratio_mismatch",
      message:
        `页面尺寸 ${page.widthPt} × ${page.heightPt} pt 的宽高比 ${validation.actual.toFixed(4)} ` +
        `偏离 16:9 达 ${(validation.relativeError * 100).toFixed(2)}%，` +
        `超出容差 ${(validation.tolerance * 100).toFixed(2)}%；不会自动裁剪、拉伸或补边`,
    },
  };
}

function isWide(page: PdfProbePage): boolean {
  if (page.widthPt <= 0 || page.heightPt <= 0) {
    return false;
  }
  return validateWideAspectRatio({
    width: page.widthPt,
    height: page.heightPt,
  }).valid;
}

/**
 * PDF 逐页抽取为 deck 页面。
 *
 * deck 不存在则创建（走临时目录 + rename，一页都没建成就整个清掉，不留半成品），
 * 存在则按 `addSlideToDeck` 的同一规则追加到末尾、既有页零改动。
 */
export async function extractPdfToDeck(
  options: ExtractPdfToDeckOptions,
): Promise<ExtractPdfToDeckResult> {
  const pdfPath = resolve(options.pdfPath);
  const deckPath = resolve(options.deckPath);
  const binaryPath = options.binaryPath ?? defaultPdfRenderBinary();
  const progress = options.onProgress ?? (() => undefined);

  if (!(await pathExists(pdfPath))) {
    throw new FoundationError("INVALID_INPUT", `PDF 文件不存在：${pdfPath}`, {
      pdfPath,
    });
  }
  const documentName = basename(pdfPath);
  const documentSha256 = await sha256File(pdfPath);

  const probe = await probePdfDocument(pdfPath, binaryPath);
  if (probe.encrypted) {
    throw new FoundationError(
      "INVALID_INPUT",
      `PDF 需要密码才能打开，本命令不做交互解锁：${pdfPath}`,
      { pdfPath },
    );
  }
  if (probe.documentPageCount === 0) {
    throw new FoundationError("INVALID_INPUT", `PDF 没有任何页面：${pdfPath}`, {
      pdfPath,
    });
  }

  const requestedPages = options.pages ?? null;
  const considered =
    requestedPages === null
      ? probe.pages.map((page) => page.pageNumber)
      : parsePageSelection(requestedPages);

  const skipped: PdfExtractionSkippedPage[] = [];
  const eligible: PdfProbePage[] = [];
  for (const pageNumber of considered) {
    const page = probe.pages.find((entry) => entry.pageNumber === pageNumber);
    if (page === undefined) {
      skipped.push({
        pageNumber,
        widthPt: null,
        heightPt: null,
        hasExtractableText: null,
        reason: {
          code: "out_of_range",
          message: `PDF 只有 ${probe.documentPageCount} 页，不存在第 ${pageNumber} 页`,
        },
      });
      continue;
    }
    if (!isWide(page)) {
      skipped.push(aspectRatioSkip(page));
      continue;
    }
    eligible.push(page);
  }

  const deckExists = await pathExists(deckPath);
  if (deckExists) {
    // 存在但不是合法 deck 时，这里给出明确错误而不是往里塞页面。
    await loadDeckWorkspace(deckPath);
  }

  const renderDirectory = await mkdtemp(join(tmpdir(), "ppt-maker-pdf-"));
  let temporaryDeck: string | null = null;
  try {
    let workingDeckPath = deckPath;
    if (!deckExists) {
      // 先建在同一父目录下的临时路径里，最后 rename 过去：一页都没建成时整个丢弃，
      // 不留半成品 deck（P5）。路径不预先创建——`createEmptyDeckWorkspace` 自己会
      // 断言目标不存在，用 mkdtemp 先占坑反而会被那条断言拒绝。
      const parent = dirname(deckPath);
      await mkdir(parent, { recursive: true });
      temporaryDeck = join(
        parent,
        `.${basename(deckPath)}.tmp-${randomUUID()}`,
      );
      await createEmptyDeckWorkspace({
        workspacePath: temporaryDeck,
        name: options.deckName ?? basename(deckPath),
      });
      workingDeckPath = temporaryDeck;
    }

    const created: PdfExtractionCreatedPage[] = [];
    for (const page of eligible) {
      // 逐页单独渲染：一页坏掉不该带走整批（design §3「跳过不中断」）。
      let rendered: Awaited<ReturnType<typeof renderPdfPages>>["pages"][number];
      try {
        const response = await renderPdfPages({
          pdfPath,
          outputDirectory: renderDirectory,
          targetWidth: PDF_RENDER_TARGET_WIDTH,
          pageNumbers: [page.pageNumber],
          binaryPath,
        });
        const first = response.pages[0];
        if (first === undefined) {
          throw new FoundationError(
            "INVALID_PROVIDER_RESPONSE",
            `渲染器没有返回第 ${page.pageNumber} 页的结果`,
            { pageNumber: page.pageNumber },
          );
        }
        rendered = first;
      } catch (error) {
        skipped.push({
          pageNumber: page.pageNumber,
          widthPt: page.widthPt,
          heightPt: page.heightPt,
          hasExtractableText: page.hasExtractableText,
          reason: { code: "render_failed", message: describeError(error) },
        });
        progress(`第 ${page.pageNumber} 页渲染失败，已跳过`);
        continue;
      }

      const source: Omit<ExtractedSource, "attemptId" | "recordedAt"> = {
        kind: "extracted",
        documentName,
        documentSha256,
        // 溯源指向原文档：跳过中间页后，这个页号仍是 PDF 里的原始页号，不是 deck 内序号。
        pageNumber: page.pageNumber,
        hasExtractableText: page.hasExtractableText,
        rendererId: probe.rendererId,
        rendererVersion: probe.rendererVersion,
        renderDpi: rendered.renderDpi,
      };

      try {
        const appended = await appendSlideWithSource({
          deckPath: workingDeckPath,
          imagePath: rendered.path,
          source,
          sourceImageName: `${documentName}#p${page.pageNumber}`,
        });
        created.push({
          pageNumber: page.pageNumber,
          workspacePath: appended.workspacePath,
          slideId: appended.slideId,
          widthPt: page.widthPt,
          heightPt: page.heightPt,
          renderDpi: rendered.renderDpi,
          hasExtractableText: page.hasExtractableText,
        });
        progress(
          `第 ${page.pageNumber} 页 → ${appended.pageLabel}（${rendered.renderDpi} DPI）`,
        );
      } catch (error) {
        skipped.push({
          pageNumber: page.pageNumber,
          widthPt: page.widthPt,
          heightPt: page.heightPt,
          hasExtractableText: page.hasExtractableText,
          reason: { code: "page_build_failed", message: describeError(error) },
        });
        progress(`第 ${page.pageNumber} 页建立工作区失败，已跳过`);
      }
    }

    skipped.sort((left, right) => left.pageNumber - right.pageNumber);

    const extractedAt = new Date().toISOString();
    const report: PdfExtractionReport = {
      schemaVersion: 1,
      documentName,
      documentSha256,
      extractedAt,
      renderer: { id: probe.rendererId, version: probe.rendererVersion },
      requestedPages,
      created,
      skipped,
    };
    const reportRelativePath = extractionReportRelativePath(
      extractedAt,
      documentSha256,
    );

    if (created.length === 0) {
      // 整份为空才失败。新建路径下临时 deck 连同报告一起丢弃——不留半成品；
      // 追加路径下 deck 本来就存在，报告照常落盘，用户需要看到每页为什么被跳过。
      let writtenReportPath: string | null = null;
      if (temporaryDeck === null) {
        writtenReportPath = resolveDeckPath(deckPath, reportRelativePath);
        await writeExtractionReport(writtenReportPath, report);
      }
      const allAspectRatio =
        skipped.length > 0 &&
        skipped.every((page) => page.reason.code === "aspect_ratio_mismatch");
      /*
       * 整份报告与它的落盘路径一并进 details。
       *
       * 抽取有**三种结局**（全建立 / 部分跳过 / 一页没建成），而报告此前只在前两种
       * 被打印——第三种下报告确实写了盘，用户却只看到一句「跳过 N 页」：没有页号、
       * 没有尺寸、没有原因、没有路径（2026-08-02 走查实证）。桌面端同理，活动日志
       * 那条失败记录不带 `reportPath`，磁盘上那份报告在界面里完全不可达。
       *
       * 报告只有页号、尺寸与中文原因，无图片内容与秘密，放进 details 不违反
       * 「details 只装可序列化诊断数据」。新建 deck 一页没建成时整个丢弃，
       * 此时 `reportPath` 为 null——报告仍在 details 里，磁盘上没有。
       */
      throw new FoundationError(
        allAspectRatio ? "INVALID_ASPECT_RATIO" : "INVALID_INPUT",
        `PDF 中没有可用于建立页面的 16:9 页：${documentName}（跳过 ${skipped.length} 页）`,
        {
          pdfPath,
          reportPath: writtenReportPath,
          report,
          skipped: skipped.map((page) => ({
            pageNumber: page.pageNumber,
            code: page.reason.code,
          })),
        },
      );
    }

    await writeExtractionReport(
      resolveDeckPath(workingDeckPath, reportRelativePath),
      report,
    );

    if (temporaryDeck !== null) {
      if (await pathExists(deckPath)) {
        throw new FoundationError(
          "WORKSPACE_EXISTS",
          `deck 工作区已存在，拒绝覆盖：${deckPath}`,
          { workspacePath: deckPath },
        );
      }
      await rename(temporaryDeck, deckPath);
      temporaryDeck = null;
    }

    return {
      deckPath,
      deckCreated: !deckExists,
      reportPath: resolveDeckPath(deckPath, reportRelativePath),
      report,
    };
  } finally {
    await rm(renderDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
    if (temporaryDeck !== null) {
      await rm(temporaryDeck, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
