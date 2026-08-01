import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FoundationError } from "@ppt-maker/core";

const execFileAsync = promisify(execFile);

/**
 * `native/macos-pdf-render` 进程边界的唯一解码点。
 *
 * 二进制的 stdout 是非可信输入，必须先解码再消费——这里不用 zod 只是因为
 * `apps/cli` 没有 zod 依赖（`openai/helpers/zod` 走的是 openai 自己的依赖树），
 * 校验强度按同样标准手写：字段缺失、类型不符、非有限数一律抛
 * `INVALID_PROVIDER_RESPONSE`，不允许 `as` 断言绕过。
 */

export interface PdfProbePage {
  readonly pageNumber: number;
  /** PDF 页原始尺寸（点），已按 /Rotate 调整。16:9 判定用它，不用渲染后的像素 */
  readonly widthPt: number;
  readonly heightPt: number;
  readonly hasExtractableText: boolean;
}

export interface PdfProbeResponse {
  readonly rendererId: string;
  readonly rendererVersion: string;
  readonly documentPageCount: number;
  /** 判据是「没有密码就读不了」，只设权限口令的 PDF 不算 */
  readonly encrypted: boolean;
  readonly pages: readonly PdfProbePage[];
}

export interface PdfRenderedPage {
  readonly pageNumber: number;
  readonly path: string;
  /**
   * 渲染器自报的像素尺寸，**只用于诊断**。
   * 源图资产尺寸一律由 `createSlideWorkspace` 从落盘文件实测填充——
   * 渲染器报的尺寸与磁盘文件不符时，实测才是真的。
   */
  readonly width: number;
  readonly height: number;
  readonly renderDpi: number;
}

export interface PdfRenderResponse {
  readonly rendererId: string;
  readonly rendererVersion: string;
  readonly pages: readonly PdfRenderedPage[];
}

const RELATIVE_BINARY_PATH = "native/macos-pdf-render/.build/macos-pdf-render";

export function defaultPdfRenderBinary(cwd = process.cwd()): string {
  const fromCwd = resolve(cwd, RELATIVE_BINARY_PATH);
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  // 二进制在仓库根，而调用方的 cwd 不一定是根（vitest 的 cwd 是 apps/cli）。
  // 只按 cwd 找会把「构建过但从子目录调用」误报成「尚未构建」。
  const fromModule = fileURLToPath(
    new URL(`../../../../${RELATIVE_BINARY_PATH}`, import.meta.url),
  );
  return existsSync(fromModule) ? fromModule : fromCwd;
}

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new FoundationError("INVALID_PROVIDER_RESPONSE", message, details);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`PDF 渲染器输出的 ${label} 不是对象`, { label });
  }
  return value as Record<string, unknown>;
}

function asString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    invalid(`PDF 渲染器输出缺少字符串字段 ${key}`, { key, value });
  }
  return value;
}

function asFiniteNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`PDF 渲染器输出的 ${key} 不是有限数值`, { key, value });
  }
  return value;
}

function asPositiveInteger(
  source: Record<string, unknown>,
  key: string,
): number {
  const value = asFiniteNumber(source, key);
  if (!Number.isInteger(value) || value <= 0) {
    invalid(`PDF 渲染器输出的 ${key} 不是正整数`, { key, value });
  }
  return value;
}

function asBoolean(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") {
    invalid(`PDF 渲染器输出的 ${key} 不是布尔值`, { key, value });
  }
  return value;
}

function asArray(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    invalid(`PDF 渲染器输出的 ${key} 不是数组`, { key });
  }
  return value;
}

function decodeProbeResponse(raw: unknown): PdfProbeResponse {
  const root = asRecord(raw, "probe 响应");
  const count = asFiniteNumber(root, "documentPageCount");
  if (!Number.isInteger(count) || count < 0) {
    invalid("PDF 渲染器输出的 documentPageCount 不是非负整数", { count });
  }
  return {
    rendererId: asString(root, "rendererId"),
    rendererVersion: asString(root, "rendererVersion"),
    documentPageCount: count,
    encrypted: asBoolean(root, "encrypted"),
    pages: asArray(root, "pages").map((entry) => {
      const page = asRecord(entry, "probe 页面");
      return {
        pageNumber: asPositiveInteger(page, "pageNumber"),
        widthPt: asFiniteNumber(page, "widthPt"),
        heightPt: asFiniteNumber(page, "heightPt"),
        hasExtractableText: asBoolean(page, "hasExtractableText"),
      };
    }),
  };
}

function decodeRenderResponse(raw: unknown): PdfRenderResponse {
  const root = asRecord(raw, "render 响应");
  return {
    rendererId: asString(root, "rendererId"),
    rendererVersion: asString(root, "rendererVersion"),
    pages: asArray(root, "pages").map((entry) => {
      const page = asRecord(entry, "render 页面");
      return {
        pageNumber: asPositiveInteger(page, "pageNumber"),
        path: asString(page, "path"),
        width: asPositiveInteger(page, "width"),
        height: asPositiveInteger(page, "height"),
        renderDpi: asPositiveInteger(page, "renderDpi"),
      };
    }),
  };
}

async function runRenderBinary(
  binaryPath: string,
  args: readonly string[],
): Promise<unknown> {
  await access(binaryPath).catch(() => {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      `PDF 渲染探针尚未构建：${binaryPath}，请先运行 pnpm build:pdf`,
      { binaryPath },
    );
  });

  const { stdout } = await execFileAsync(binaryPath, [...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  try {
    return JSON.parse(stdout);
  } catch {
    return invalid("PDF 渲染器 stdout 不是合法 JSON", {
      preview: stdout.slice(0, 200),
    });
  }
}

export async function probePdfDocument(
  pdfPath: string,
  binaryPath = defaultPdfRenderBinary(),
): Promise<PdfProbeResponse> {
  return decodeProbeResponse(
    await runRenderBinary(binaryPath, ["probe", resolve(pdfPath)]),
  );
}

export interface RenderPdfPagesOptions {
  readonly pdfPath: string;
  readonly outputDirectory: string;
  readonly targetWidth: number;
  /** 已通过 16:9 判定的页号（PDF 原始页号）。判定在 TS 侧完成，渲染器不做业务判断 */
  readonly pageNumbers: readonly number[];
  readonly binaryPath?: string;
}

export async function renderPdfPages(
  options: RenderPdfPagesOptions,
): Promise<PdfRenderResponse> {
  const binaryPath = options.binaryPath ?? defaultPdfRenderBinary();
  return decodeRenderResponse(
    await runRenderBinary(binaryPath, [
      "render",
      resolve(options.pdfPath),
      resolve(options.outputDirectory),
      String(options.targetWidth),
      "--pages",
      options.pageNumbers.join(","),
    ]),
  );
}
