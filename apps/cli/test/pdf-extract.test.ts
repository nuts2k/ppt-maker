import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtractedSource } from "@ppt-maker/core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { loadDeckWorkspace } from "../src/deck/workspace.js";
import {
  extractionFailureDetails,
  extractPdfToDeck,
} from "../src/pdf/extract.js";
import { parsePageSelection } from "../src/pdf/pages.js";
import { replaceSlideSource } from "../src/slide/replace-source.js";
import { loadSlideWorkspace } from "../src/slide/workspace.js";

function fixturePath(name: string): string {
  return fileURLToPath(
    new URL(`../../../fixtures/pdf-extraction/${name}`, import.meta.url),
  );
}

function imageFixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

async function workspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `ppt-maker-${prefix}-`));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256Of(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

describe("deck extract：PDF 逐页抽取", () => {
  it("按原始页尺寸逐页判定，只建立 16:9 页并把跳过原因写进报告", async () => {
    const parent = await workspace("pdf-extract");
    const deckPath = join(parent, "deck");

    const result = await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
    });

    expect(result.deckCreated).toBe(true);
    // 合成件 5 页：1/3/5 为 16:9，2（A4 横）与 4（A4 竖）非 16:9。
    expect(result.report.created.map((page) => page.pageNumber)).toEqual([
      1, 3, 5,
    ]);
    expect(result.report.skipped.map((page) => page.pageNumber)).toEqual([
      2, 4,
    ]);
    for (const skipped of result.report.skipped) {
      expect(skipped.reason.code).toBe("aspect_ratio_mismatch");
      // 跳过项必须带尺寸与人类可读原因，否则界面上只能显示「跳过了」。
      expect(skipped.widthPt).toBeGreaterThan(0);
      expect(skipped.heightPt).toBeGreaterThan(0);
      expect(skipped.reason.message).toContain("pt");
    }

    // P6 页号溯源：deck 内是第 2 页，但它的 pageNumber 指向 PDF 原始第 3 页。
    const deck = await loadDeckWorkspace(deckPath);
    expect(deck.manifest.slides.map((slide) => slide.workspacePath)).toEqual([
      "slides/page-01",
      "slides/page-02",
      "slides/page-03",
    ]);
    const second = await loadSlideWorkspace(join(deckPath, "slides/page-02"));
    const source = second.manifest.source as ExtractedSource;
    expect(source.kind).toBe("extracted");
    expect(source.pageNumber).toBe(3);
    expect(source.documentName).toBe("mixed-aspect.pdf");
    expect(source.documentSha256).toBe(
      await sha256Of(fixturePath("mixed-aspect.pdf")),
    );
    expect(source.rendererId).toBe("macos-pdfkit");
    expect(source.rendererVersion).toContain("macOS-");
    expect(source.renderDpi).toBeGreaterThan(0);

    // P11 报告落盘可读。
    expect(await exists(result.reportPath)).toBe(true);
    const stored = JSON.parse(await readFile(result.reportPath, "utf8"));
    expect(stored.created).toHaveLength(3);
    expect(stored.skipped).toHaveLength(2);
    expect(stored.requestedPages).toBeNull();
  });

  it("源图资产尺寸等于磁盘 PNG 的实际像素，而不是请求的目标宽度", async () => {
    const parent = await workspace("pdf-extract-size");
    const deckPath = join(parent, "deck");

    await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
      pages: "1",
    });

    const slidePath = join(deckPath, "slides/page-01");
    const { manifest } = await loadSlideWorkspace(slidePath);
    const asset = manifest.assets.find(
      (entry) => entry.id === manifest.sourceImageAssetId,
    );
    expect(asset?.image).not.toBeNull();

    // 用另一个库独立实测磁盘文件，而不是拿渲染器自报的值或请求参数来对。
    const measured = await sharp(join(slidePath, asset?.path ?? "")).metadata();
    expect(asset?.image?.width).toBe(measured.width);
    expect(asset?.image?.height).toBe(measured.height);
  });

  it("逐页记录文本层可提取性", async () => {
    const parent = await workspace("pdf-extract-text");
    const deckPath = join(parent, "deck");

    const result = await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
    });

    // 合成件第 5 页是纯图形页，探测应得 false；1/3 页有文字。
    expect(
      result.report.created.map((page) => [
        page.pageNumber,
        page.hasExtractableText,
      ]),
    ).toEqual([
      [1, true],
      [3, true],
      [5, false],
    ]);
    const third = await loadSlideWorkspace(join(deckPath, "slides/page-03"));
    expect((third.manifest.source as ExtractedSource).hasExtractableText).toBe(
      false,
    );
  });

  it("整份没有 16:9 页时失败，且不留下半成品 deck", async () => {
    const parent = await workspace("pdf-extract-empty");
    const deckPath = join(parent, "deck");

    await expect(
      extractPdfToDeck({
        pdfPath: fixturePath("no-wide.pdf"),
        deckPath,
      }),
    ).rejects.toThrow("没有可用于建立页面的 16:9 页");

    expect(await exists(deckPath)).toBe(false);
  });

  /*
   * 缺陷回归（2026-08-02 阶段三走查，A5 可见性）：抽取有**三种结局**，
   * 「追加路径 + 一页都没建成」是第三种——报告确实写了盘，用户却只看到一句
   * 「跳过 N 页」：没有页号、没有尺寸、没有原因、没有报告路径。
   * 桌面端同理，那条失败记录不带 reportPath，磁盘上的报告在界面里完全不可达。
   */
  it("追加路径下零建立：报告落盘，且路径与逐页原因进错误详情", async () => {
    const parent = await workspace("pdf-extract-empty-append");
    const deckPath = join(parent, "deck");
    await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
    });

    const error = await extractPdfToDeck({
      pdfPath: fixturePath("no-wide.pdf"),
      deckPath,
    }).catch((caught: unknown) => caught);

    const failure = extractionFailureDetails(error);
    expect(failure).not.toBeNull();
    // 报告确实在磁盘上，而不是只在错误对象里
    expect(failure?.reportPath).not.toBeNull();
    expect(await exists(failure?.reportPath ?? "")).toBe(true);
    expect(failure?.report.created).toHaveLength(0);
    expect(failure?.report.skipped.length).toBeGreaterThan(0);
    // 逐页尺寸与中文原因齐备——这正是那句「跳过 N 页」丢掉的东西
    for (const page of failure?.report.skipped ?? []) {
      expect(page.widthPt).not.toBeNull();
      expect(page.reason.message.length).toBeGreaterThan(0);
    }
  });

  it("新建路径下零建立：报告仍进错误详情，但磁盘上没有（deck 整个丢弃）", async () => {
    const parent = await workspace("pdf-extract-empty-fresh");
    const deckPath = join(parent, "deck");

    const failure = extractionFailureDetails(
      await extractPdfToDeck({
        pdfPath: fixturePath("no-wide.pdf"),
        deckPath,
      }).catch((caught: unknown) => caught),
    );

    expect(failure?.reportPath).toBeNull();
    expect(failure?.report.skipped.length).toBeGreaterThan(0);
    expect(await exists(deckPath)).toBe(false);
  });

  it("追加到已有 deck 时既有页零改动、page-NN 不重排", async () => {
    const parent = await workspace("pdf-extract-append");
    const deckPath = join(parent, "deck");

    await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
    });
    const before = await loadDeckWorkspace(deckPath);
    const beforeManifests = await Promise.all(
      before.manifest.slides.map((slide) =>
        readFile(join(deckPath, slide.workspacePath, "manifest.json"), "utf8"),
      ),
    );

    const second = await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
    });
    expect(second.deckCreated).toBe(false);

    const after = await loadDeckWorkspace(deckPath);
    expect(after.manifest.slides.map((slide) => slide.workspacePath)).toEqual([
      "slides/page-01",
      "slides/page-02",
      "slides/page-03",
      "slides/page-04",
      "slides/page-05",
      "slides/page-06",
    ]);
    // 既有条目逐字未变（deckId / createdAt / 前三条 slides）。
    expect(after.manifest.slides.slice(0, 3)).toEqual(before.manifest.slides);
    expect(after.manifest.deckId).toBe(before.manifest.deckId);
    expect(after.manifest.createdAt).toBe(before.manifest.createdAt);
    const afterManifests = await Promise.all(
      before.manifest.slides.map((slide) =>
        readFile(join(deckPath, slide.workspacePath, "manifest.json"), "utf8"),
      ),
    );
    expect(afterManifests).toEqual(beforeManifests);
  });

  it("抽取页自动放行源图确认，但磁盘上没有 accepted.json", async () => {
    const parent = await workspace("pdf-extract-gate");
    const deckPath = join(parent, "deck");

    await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
      pages: "1",
    });

    const slidePath = join(deckPath, "slides/page-01");
    const { manifest } = await loadSlideWorkspace(slidePath);
    expect(
      manifest.stages.find((stage) => stage.stage === "accept-source")?.status,
    ).toBe("completed");
    // 判据就是这个文件在不在：状态可以是 completed，人工痕迹不能伪造。
    expect(await exists(join(slidePath, "stages/source/accepted.json"))).toBe(
      false,
    );
    expect(
      manifest.assets.some((asset) => asset.role === "source_acceptance"),
    ).toBe(false);
    expect(
      manifest.attempts.find((attempt) => attempt.stage === "accept-source")
        ?.provider,
    ).toBe("auto-source-trust");
  });

  it("抽取页与导入图可双向换源，两者都不需要人工确认", async () => {
    const parent = await workspace("pdf-extract-swap");
    const deckPath = join(parent, "deck");

    await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
      pages: "1",
    });
    const slidePath = join(deckPath, "slides/page-01");

    const toImported = await replaceSlideSource({
      workspacePath: slidePath,
      imagePath: imageFixturePath(),
      source: { kind: "imported", originalFileName: "mixed-text.png" },
    });
    expect(toImported.requiresAcceptance).toBe(false);
    const imported = await loadSlideWorkspace(slidePath);
    expect(imported.manifest.source.kind).toBe("imported");

    const backToExtracted = await replaceSlideSource({
      workspacePath: slidePath,
      imagePath: imageFixturePath(),
      source: {
        kind: "extracted",
        documentName: "mixed-aspect.pdf",
        documentSha256: await sha256Of(fixturePath("mixed-aspect.pdf")),
        pageNumber: 3,
        hasExtractableText: true,
        rendererId: "macos-pdfkit",
        rendererVersion: "1+macOS-test",
        renderDpi: 205,
      },
    });
    expect(backToExtracted.requiresAcceptance).toBe(false);
    const extracted = await loadSlideWorkspace(slidePath);
    expect(extracted.manifest.source.kind).toBe("extracted");
    expect((extracted.manifest.source as ExtractedSource).pageNumber).toBe(3);
    expect(await exists(join(slidePath, "stages/source/accepted.json"))).toBe(
      false,
    );
  });

  it("--pages 指定的越界页进入报告的 out_of_range，不静默消失", async () => {
    const parent = await workspace("pdf-extract-range");
    const deckPath = join(parent, "deck");

    const result = await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
      pages: "1,3,99",
    });

    expect(result.report.requestedPages).toBe("1,3,99");
    expect(result.report.created.map((page) => page.pageNumber)).toEqual([
      1, 3,
    ]);
    const missing = result.report.skipped.find(
      (page) => page.pageNumber === 99,
    );
    expect(missing?.reason.code).toBe("out_of_range");
    expect(missing?.widthPt).toBeNull();
  });

  it("需要密码的 PDF 直接报错，不做交互解锁也不建 deck", async () => {
    const parent = await workspace("pdf-extract-locked");
    const deckPath = join(parent, "deck");

    await expect(
      extractPdfToDeck({
        pdfPath: fixturePath("password-protected.pdf"),
        deckPath,
      }),
    ).rejects.toThrow("需要密码");
    expect(await exists(deckPath)).toBe(false);
  });

  it("二进制缺失时提示先运行 pnpm build:pdf", async () => {
    const parent = await workspace("pdf-extract-binary");

    await expect(
      extractPdfToDeck({
        pdfPath: fixturePath("mixed-aspect.pdf"),
        deckPath: join(parent, "deck"),
        binaryPath: join(parent, "missing-binary"),
      }),
    ).rejects.toThrow("pnpm build:pdf");
    expect(await exists(join(parent, "deck"))).toBe(false);
  });

  it("报告文件名不含冒号，便于在 Finder 中查看", async () => {
    const parent = await workspace("pdf-extract-report-name");
    const deckPath = join(parent, "deck");

    const result = await extractPdfToDeck({
      pdfPath: fixturePath("mixed-aspect.pdf"),
      deckPath,
      pages: "1",
    });

    expect(result.reportPath).toContain("/extractions/");
    expect(result.reportPath.split("/").at(-1)).not.toContain(":");
    expect((await stat(result.reportPath)).size).toBeGreaterThan(0);
  });
});

describe("--pages 范围解析", () => {
  it("展开区间并升序去重", () => {
    expect(parsePageSelection("3-5,12,4")).toEqual([3, 4, 5, 12]);
    expect(parsePageSelection(" 7 ")).toEqual([7]);
  });

  it("拒绝非法输入", () => {
    expect(() => parsePageSelection("")).toThrow("不能为空");
    expect(() => parsePageSelection("0")).toThrow("必须从 1 开始");
    expect(() => parsePageSelection("5-3")).toThrow("起点大于终点");
    expect(() => parsePageSelection("a")).toThrow("只接受页号");
    expect(() => parsePageSelection("1,,2")).toThrow("空的区间");
  });
});
