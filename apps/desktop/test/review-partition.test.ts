/**
 * 分区计数用真实数据锁定：夹具 `fixtures/review-partition/page-0N.json` 复制自
 * 真实工作区 `~/test/ppttest-2026-07-25`（经任务快照
 * `.trellis/tasks/07-26-review-flow-simplification/research/data-snapshot/`），内容未改。
 *
 * 之所以复制而不是从 `.trellis/tasks/` 直接读：任务归档后该路径会失效，
 * 而这几个数字（PRD F-9 实测）是分区判据唯一的真实回归锚点。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type TextReviewBlock,
  TextReviewDocumentSchema,
} from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  partitionOf,
  REVIEW_PARTITION_LABELS,
  type ReviewPartition,
  unreviewedBlockIds,
} from "../src/renderer/lib/review-partition.js";

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/review-partition",
);

function loadFixtureBlocks(page: string): readonly TextReviewBlock[] {
  const raw = JSON.parse(readFileSync(resolve(fixtureDir, page), "utf8"));
  return TextReviewDocumentSchema.parse(raw).blocks;
}

function block(
  id: string,
  classification: TextReviewBlock["classification"],
  sources: TextReviewBlock["sources"],
): TextReviewBlock {
  return {
    schemaVersion: 1,
    id,
    text: id,
    lines: [id],
    bboxPx: { x: 0, y: 0, width: 10, height: 10 },
    quadPx: null,
    rotationDeg: 0,
    zIndex: 0,
    classification,
    sources,
    includeInMask: classification === "layout_text",
    reviewStatus: "unreviewed",
    riskAcceptance: null,
    style: {
      fontSizePx: null,
      fontWeight: null,
      colorHex: null,
      horizontalAlign: null,
      verticalAlign: null,
      lineHeight: null,
    },
    maskParams: {
      foregroundColors: [],
      colorTolerance: 0,
      edgeThreshold: 0,
      minComponentAreaPx: 0,
      dilationRadiusPx: 0,
      excludePolygons: [],
    },
    updatedAt: null,
  };
}

function ocrSource(text: string): TextReviewBlock["sources"][number] {
  return {
    kind: "offline_ocr",
    provider: "apple-vision",
    text,
    confidence: 0.9,
  };
}

function assistSource(text: string): TextReviewBlock["sources"][number] {
  return {
    kind: "ai_text_assist",
    provider: "openai",
    text,
    confidence: null,
  };
}

function countByPartition(
  blocks: readonly TextReviewBlock[],
): Record<ReviewPartition, number> {
  const counts: Record<ReviewPartition, number> = {
    "text-pending": 0,
    "classification-pending": 0,
    agreed: 0,
  };
  for (const item of blocks) counts[partitionOf(item)] += 1;
  return counts;
}

describe("partitionOf", () => {
  it("object_integrated_symbol 归入分类待确认（PRD F-7 的漏字风险要逐项过目）", () => {
    const target = block("a", "object_integrated_symbol", [
      ocrSource("历史脉络"),
      assistSource("历史脉络"),
    ]);
    // 即使双源一致也不能落进「已一致」——待确认的是分类，不是文字
    expect(partitionOf(target)).toBe("classification-pending");
  });

  it("uncertain 归入分类待确认", () => {
    expect(partitionOf(block("a", "uncertain", []))).toBe(
      "classification-pending",
    );
  });

  it("layout_text 双源逐字一致（忽略空白）归入已一致", () => {
    const target = block("a", "layout_text", [
      ocrSource("主要结论"),
      assistSource("主要 结论"),
    ]);
    expect(partitionOf(target)).toBe("agreed");
  });

  it("layout_text 双源分歧归入文字待确认", () => {
    const target = block("a", "layout_text", [
      ocrSource("主贾蛸论"),
      assistSource("主要结论"),
    ]);
    expect(partitionOf(target)).toBe("text-pending");
  });

  it("layout_text 缺一个来源归入文字待确认（无从比对不等于已确认一致）", () => {
    expect(
      partitionOf(block("a", "layout_text", [ocrSource("外郎波动")])),
    ).toBe("text-pending");
    expect(
      partitionOf(block("b", "layout_text", [assistSource("销量波动")])),
    ).toBe("text-pending");
    expect(partitionOf(block("c", "layout_text", []))).toBe("text-pending");
  });
});

// 分区不再是列表结构（partitionBlocks / orderedReviewBlocks 已随 07-28 任务删除），
// 但真实数据的分区计数仍是判据唯一的回归锚点，必须留住。
describe("真实数据的分区计数", () => {
  it("page-01 真实数据：文字待确认 25 / 分类待确认 16 / 已一致 19", () => {
    const blocks = loadFixtureBlocks("page-01.json");
    expect(blocks.length).toBe(60);
    expect(countByPartition(blocks)).toEqual({
      "text-pending": 25,
      "classification-pending": 16,
      agreed: 19,
    });
  });

  it("page-02 真实数据：文字待确认 45 / 分类待确认 18 / 已一致 32", () => {
    const blocks = loadFixtureBlocks("page-02.json");
    expect(blocks.length).toBe(95);
    expect(countByPartition(blocks)).toEqual({
      "text-pending": 45,
      "classification-pending": 18,
      agreed: 32,
    });
  });
});

describe("REVIEW_PARTITION_LABELS", () => {
  it("三分区都有中文标题（现作为每项的徽标文字）", () => {
    expect(REVIEW_PARTITION_LABELS).toEqual({
      "text-pending": "文字待确认",
      "classification-pending": "分类待确认",
      agreed: "已一致",
    });
  });
});

describe("unreviewedBlockIds", () => {
  const symbol = block("s1", "object_integrated_symbol", []);
  const text = block("t1", "layout_text", [
    {
      kind: "offline_ocr",
      provider: "apple-vision",
      text: "甲",
      confidence: 1,
    },
    {
      kind: "ai_text_assist",
      provider: "openai-text-assist",
      text: "乙",
      confidence: null,
    },
  ]);

  it("只数未复核项，已复核的不计入", () => {
    expect(unreviewedBlockIds([symbol, text])).toEqual(["s1", "t1"]);
    expect(
      unreviewedBlockIds([{ ...symbol, reviewStatus: "reviewed" }, text]),
    ).toEqual(["t1"]);
  });

  it("全部复核后归零", () => {
    expect(
      unreviewedBlockIds([
        { ...symbol, reviewStatus: "reviewed" },
        { ...text, reviewStatus: "reviewed" },
      ]),
    ).toEqual([]);
  });

  /**
   * E1 走查实测缺陷的回归锚点：确认一个符号块「它就是符号」是幂等操作，分区归属
   * 不变，但进度必须动。徽标此前显示 blocks.length，用户因此判定操作没生效。
   */
  it("确认符号块后分区归属不变，但该区未复核数下降", () => {
    const confirmed: TextReviewBlock = {
      ...symbol,
      reviewStatus: "reviewed",
    };
    expect(partitionOf(confirmed)).toBe("classification-pending");
    expect(partitionOf(symbol)).toBe(partitionOf(confirmed));
    expect(unreviewedBlockIds([symbol]).length).toBe(1);
    expect(unreviewedBlockIds([confirmed]).length).toBe(0);
  });

  it("编辑文字块不改变双源分歧，进度仍只由 reviewStatus 表达", () => {
    // 人工编辑写入 manual 源与 block.text，offline_ocr / ai_text_assist 两个原始源不变
    const edited: TextReviewBlock = {
      ...text,
      text: "丙",
      reviewStatus: "reviewed",
      sources: [
        ...text.sources,
        { kind: "manual", provider: "human", text: "丙", confidence: null },
      ],
    };
    expect(partitionOf(edited)).toBe("text-pending");
    expect(unreviewedBlockIds([edited])).toEqual([]);
  });
});
