import { describe, expect, it } from "vitest";
import {
  DIFF_LCS_MAX_CHARS,
  type DiffSegment,
  diffChars,
  shouldFallbackToSideBySide,
} from "../src/renderer/lib/text-diff.js";

/** same + ocr-only 拼回即 OCR 原文 */
function rebuildOcr(segments: readonly DiffSegment[]): string {
  return segments
    .filter((segment) => segment.kind !== "assist-only")
    .map((segment) => segment.text)
    .join("");
}

/** same + assist-only 拼回即 assist 文本 */
function rebuildAssist(segments: readonly DiffSegment[]): string {
  return segments
    .filter((segment) => segment.kind !== "ocr-only")
    .map((segment) => segment.text)
    .join("");
}

describe("diffChars 不变量", () => {
  // 真实分歧样本取自 PRD F-9（page-02 block-009）
  const cases: readonly (readonly [string, string])[] = [
    ["象衽鲍洁高雅、连锦不绝，", "象征洁净高雅、连绵不绝，"],
    ["主贾蛸论", "主要结论"],
    ["外郎波动", "销量波动"],
    ["Al Agent", "AI Agent"],
    ["", "新增整句"],
    ["整句删除", ""],
    ["完全一致", "完全一致"],
  ];

  for (const [ocr, assist] of cases) {
    it(`分段可无损还原两侧原文：「${ocr}」/「${assist}」`, () => {
      const segments = diffChars(ocr, assist);
      expect(rebuildOcr(segments)).toBe(ocr);
      expect(rebuildAssist(segments)).toBe(assist);
    });
  }

  it("两侧皆空返回空数组", () => {
    expect(diffChars("", "")).toEqual([]);
  });

  it("完全相同只返回一个 same 段", () => {
    expect(diffChars("象征洁净高雅", "象征洁净高雅")).toEqual([
      { kind: "same", text: "象征洁净高雅" },
    ]);
  });
});

describe("diffChars 分段合并", () => {
  it("相邻同类合并：真实样本段数远小于字符数", () => {
    const ocr = "象衽鲍洁高雅、连锦不绝，";
    const segments = diffChars(ocr, "象征洁净高雅、连绵不绝，");
    // 逐字符返回会是 12 段；合并后为 9 段（差异集中在「衽鲍/征」「净」「锦/绵」三处）
    expect(segments.length).toBeLessThan(Array.from(ocr).length);
    expect(segments.length).toBe(9);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i]?.kind).not.toBe(segments[i - 1]?.kind);
    }
  });

  it("连续差异合并为整段而非逐字", () => {
    const segments = diffChars("前abc后", "前xyz后");
    expect(segments).toEqual([
      { kind: "same", text: "前" },
      { kind: "ocr-only", text: "abc" },
      { kind: "assist-only", text: "xyz" },
      { kind: "same", text: "后" },
    ]);
  });

  it("不产生空文本分段", () => {
    for (const segment of diffChars("主贾蛸论", "主要结论")) {
      expect(segment.text.length).toBeGreaterThan(0);
    }
  });

  it("按码点切分，不拆坏代理对", () => {
    const segments = diffChars("图标🙂尾", "图标🙃尾");
    expect(rebuildOcr(segments)).toBe("图标🙂尾");
    expect(rebuildAssist(segments)).toBe("图标🙃尾");
    expect(
      segments.every(
        (segment) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(segment.text),
      ),
    ).toBe(true);
  });
});

describe("超长回退", () => {
  const long = "文".repeat(DIFF_LCS_MAX_CHARS + 1);

  it("阈值内不回退", () => {
    const atLimit = "文".repeat(DIFF_LCS_MAX_CHARS);
    expect(shouldFallbackToSideBySide(atLimit, atLimit)).toBe(false);
  });

  it("任一侧超阈值即回退", () => {
    expect(shouldFallbackToSideBySide(long, "短")).toBe(true);
    expect(shouldFallbackToSideBySide("短", long)).toBe(true);
  });

  it("回退时返回整段两分，仍满足还原不变量", () => {
    const segments = diffChars(long, `${long}尾`);
    expect(segments).toEqual([
      { kind: "ocr-only", text: long },
      { kind: "assist-only", text: `${long}尾` },
    ]);
    expect(rebuildOcr(segments)).toBe(long);
    expect(rebuildAssist(segments)).toBe(`${long}尾`);
  });

  it("回退时两侧完全相同仍返回单个 same 段", () => {
    expect(diffChars(long, long)).toEqual([{ kind: "same", text: long }]);
  });
});
