/**
 * 抽取报告展示口径的回归锁（R8 / U4 / U5）。
 *
 * 守两件事：
 *
 * 1. **原因文案逐字来自 `reason.message`**。桌面端重拼一份必然与 CLI 漂移，而且是
 *    静默漂移——两边都不会报错，只是说法慢慢对不上。用例里刻意给一句「只可能来自
 *    报告」的原文，桌面端一旦改成自己编的句子就转红。
 * 2. **跳过不上校对红**。混合宽高比的 PDF 跳掉非 16:9 页是抽取的设计内结果，
 *    不是故障（U5 的核心：命令不整体失败）。
 */

import type { PdfExtractionReport } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  createdLines,
  formatCreatedPage,
  formatSkippedPage,
  groupSkippedPages,
  SKIP_REASON_LABELS,
  skipTone,
  summarizeExtraction,
} from "../src/renderer/lib/extraction-report-view.js";

function makeReport(
  overrides: Partial<PdfExtractionReport> = {},
): PdfExtractionReport {
  return {
    schemaVersion: 1,
    documentName: "b2-export-strict.pdf",
    documentSha256: "a".repeat(64),
    extractedAt: "2026-08-01T02:03:04.000Z",
    renderer: { id: "macos-pdfkit", version: "1.0.0+macOS 15.5" },
    requestedPages: null,
    created: [],
    skipped: [],
    ...overrides,
  };
}

const CREATED_PAGE = {
  pageNumber: 3,
  workspacePath: "slides/page-03",
  slideId: "slide-page-03",
  widthPt: 960,
  heightPt: 540,
  renderDpi: 153.6,
  hasExtractableText: true,
} as const;

describe("摘要", () => {
  it("建立 / 跳过计数取自两个数组长度", () => {
    const summary = summarizeExtraction(
      makeReport({
        created: [CREATED_PAGE, { ...CREATED_PAGE, pageNumber: 4 }],
        skipped: [
          {
            pageNumber: 7,
            widthPt: 1224,
            heightPt: 792,
            hasExtractableText: false,
            reason: { code: "aspect_ratio_mismatch", message: "不合比例" },
          },
        ],
      }),
    );
    expect(summary.createdCount).toBe(2);
    expect(summary.skippedCount).toBe(1);
    expect(summary.documentName).toBe("b2-export-strict.pdf");
  });

  it("建立为空时计数为 0，不报错也不隐藏文档信息", () => {
    const summary = summarizeExtraction(makeReport());
    expect(summary.createdCount).toBe(0);
    expect(summary.skippedCount).toBe(0);
    expect(summary.documentName).toBe("b2-export-strict.pdf");
  });

  it("页码范围原样回显，未指定时为「全部页」", () => {
    expect(summarizeExtraction(makeReport()).requestedPagesText).toBe("全部页");
    expect(
      summarizeExtraction(makeReport({ requestedPages: "3-8,12" }))
        .requestedPagesText,
    ).toBe("第 3-8,12 页");
  });

  /** 渲染器 id + 版本是「同一页可复现」的锚点，不能只显示 id */
  it("渲染器带版本", () => {
    expect(summarizeExtraction(makeReport()).rendererText).toContain("1.0.0");
    expect(summarizeExtraction(makeReport()).rendererText).toContain(
      "macos-pdfkit",
    );
  });
});

describe("建立页一行", () => {
  it("含页号、工作区名、尺寸与文本层", () => {
    const text = formatCreatedPage(CREATED_PAGE);
    expect(text).toContain("第 3 页");
    expect(text).toContain("page-03");
    expect(text).toContain("960×540 pt");
    expect(text).toContain("含可提取文本层");
  });

  it("无文本层的页如实说无", () => {
    expect(
      formatCreatedPage({ ...CREATED_PAGE, hasExtractableText: false }),
    ).toContain("无可提取文本层");
  });

  /** PDF 的点尺寸常带小数尾巴（595.276），全量打出来会把一行挤爆 */
  it("非整数尺寸保留一位小数", () => {
    expect(
      formatCreatedPage({
        ...CREATED_PAGE,
        widthPt: 595.276,
        heightPt: 841.89,
      }),
    ).toContain("595.3×841.9 pt");
  });

  it("createdLines 逐条产出且以页号为 key", () => {
    const lines = createdLines(
      makeReport({
        created: [CREATED_PAGE, { ...CREATED_PAGE, pageNumber: 5 }],
      }),
    );
    expect(lines.map((line) => line.pageNumber)).toEqual([3, 5]);
    expect(lines[0]?.text).toContain("第 3 页");
  });
});

/** 四种 code 各造一条；`message` 全部写成「只可能来自报告」的原文 */
const SKIPPED = {
  aspect_ratio_mismatch: {
    pageNumber: 7,
    widthPt: 1224,
    heightPt: 792,
    hasExtractableText: true,
    reason: {
      code: "aspect_ratio_mismatch",
      message: "页面宽高比 1.545，偏离 16:9 超出容差 0.005",
    },
  },
  out_of_range: {
    pageNumber: 99,
    widthPt: null,
    heightPt: null,
    hasExtractableText: null,
    reason: {
      code: "out_of_range",
      message: "PDF 只有 12 页，不存在第 99 页",
    },
  },
  render_failed: {
    pageNumber: 4,
    widthPt: 960,
    heightPt: 540,
    hasExtractableText: false,
    reason: { code: "render_failed", message: "渲染器返回空结果" },
  },
  page_build_failed: {
    pageNumber: 5,
    widthPt: 960,
    heightPt: 540,
    hasExtractableText: false,
    reason: { code: "page_build_failed", message: "目标工作区已存在" },
  },
} as const satisfies Record<string, PdfExtractionReport["skipped"][number]>;

const ALL_CODES = [
  "aspect_ratio_mismatch",
  "out_of_range",
  "render_failed",
  "page_build_failed",
] as const;

describe("跳过页一行", () => {
  it("含页号、尺寸与报告原文", () => {
    const text = formatSkippedPage(SKIPPED.aspect_ratio_mismatch);
    expect(text).toBe(
      "第 7 页 · 1224×792 pt · 页面宽高比 1.545，偏离 16:9 超出容差 0.005",
    );
  });

  /**
   * 越界页在文档里根本不存在，没有尺寸可报。**不得**编造一个 0×0——
   * 那是把「不知道」伪装成「知道，是 0」。
   */
  it("越界页尺寸为 null 时写「尺寸未知」", () => {
    const text = formatSkippedPage(SKIPPED.out_of_range);
    expect(text).toContain("尺寸未知");
    expect(text).not.toMatch(/null|NaN|0×0/);
    expect(text).toContain("PDF 只有 12 页，不存在第 99 页");
  });

  /**
   * 核心锁：四种 code 的正文都必须逐字包含报告里的 `message`。
   * 桌面端一旦改成按 code 自己拼一句，这条立刻转红。
   */
  it("四种 code 的正文一律逐字取自 reason.message", () => {
    for (const code of ALL_CODES) {
      const page = SKIPPED[code];
      expect(formatSkippedPage(page), `${code} 丢了报告原文`).toContain(
        page.reason.message,
      );
    }
  });
});

describe("按原因分组", () => {
  it("空跳过列表产出空数组，不留空分组", () => {
    expect(groupSkippedPages([])).toEqual([]);
  });

  it("四种 code 各成一组，顺序固定且不随出现次序变", () => {
    // 刻意逆序传入：分组顺序若跟着输入走，下面的断言就会红
    const groups = groupSkippedPages([
      SKIPPED.page_build_failed,
      SKIPPED.render_failed,
      SKIPPED.out_of_range,
      SKIPPED.aspect_ratio_mismatch,
    ]);
    expect(groups.map((group) => group.code)).toEqual([...ALL_CODES]);
    for (const group of groups) {
      expect(group.lines).toHaveLength(1);
      expect(group.label).toBe(SKIP_REASON_LABELS[group.code]);
    }
  });

  it("同一 code 的多页归进同一组，组内保持报告顺序", () => {
    const groups = groupSkippedPages([
      SKIPPED.aspect_ratio_mismatch,
      { ...SKIPPED.aspect_ratio_mismatch, pageNumber: 8 },
      SKIPPED.render_failed,
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.lines.map((line) => line.pageNumber)).toEqual([7, 8]);
    expect(groups[1]?.lines.map((line) => line.pageNumber)).toEqual([4]);
  });

  it("四种 code 都有中文标题", () => {
    for (const code of ALL_CODES) {
      expect(SKIP_REASON_LABELS[code]?.length ?? 0).toBeGreaterThan(0);
    }
    expect(Object.keys(SKIP_REASON_LABELS).sort()).toEqual(
      [...ALL_CODES].sort(),
    );
  });
});

/**
 * U5 的界面一半：混合宽高比的 PDF 抽取后**命令不整体失败**，非 16:9 页出现在跳过
 * 列表里。既然不是失败，界面就不该把它标成故障——「有颜色 = 要你管」这条扫读规则
 * 一旦被常态污染，整套配色就失去意义（旧版 9 个绿点就是这么来的）。
 */
describe("跳过的视觉档位", () => {
  it("设计内的跳过保持中性", () => {
    expect(skipTone("aspect_ratio_mismatch")).toBe("neutral");
    expect(skipTone("out_of_range")).toBe("neutral");
  });

  /** 「本该能出、结果没出」才标注，且用 state-stale 而非校对红 */
  it("渲染/建页失败标注为 stale", () => {
    expect(skipTone("render_failed")).toBe("stale");
    expect(skipTone("page_build_failed")).toBe("stale");
  });

  it("没有任何档位是校对红", () => {
    for (const code of ALL_CODES) {
      expect(skipTone(code)).not.toBe("proof");
      expect(["neutral", "stale"]).toContain(skipTone(code));
    }
  });

  it("分组带上的 tone 与 skipTone 同源", () => {
    for (const code of ALL_CODES) {
      const groups = groupSkippedPages([SKIPPED[code]]);
      expect(groups[0]?.tone).toBe(skipTone(code));
    }
  });
});
