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
  orderedReviewBlocks,
  partitionBlocks,
  partitionOf,
  REVIEW_PARTITION_LABELS,
  REVIEW_PARTITION_ORDER,
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

function countByPartition(blocks: readonly TextReviewBlock[]) {
  return Object.fromEntries(
    partitionBlocks(blocks).map((group) => [
      group.partition,
      group.blocks.length,
    ]),
  );
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

describe("partitionBlocks", () => {
  it("空文档仍返回三组，计数为 0（界面结构不随数据变形）", () => {
    const groups = partitionBlocks([]);
    expect(groups.map((group) => group.partition)).toEqual([
      ...REVIEW_PARTITION_ORDER,
    ]);
    expect(groups.every((group) => group.blocks.length === 0)).toBe(true);
  });

  it("分区内保持输入顺序（存储顺序即阅读顺序）", () => {
    const blocks = [
      block("b1", "layout_text", [ocrSource("甲"), assistSource("乙")]),
      block("b2", "object_integrated_symbol", []),
      block("b3", "layout_text", [ocrSource("丙"), assistSource("丁")]),
      block("b4", "layout_text", [ocrSource("戊"), assistSource("戊")]),
    ];
    const groups = partitionBlocks(blocks);
    expect(groups[0]?.blocks.map((item) => item.id)).toEqual(["b1", "b3"]);
    expect(groups[1]?.blocks.map((item) => item.id)).toEqual(["b2"]);
    expect(groups[2]?.blocks.map((item) => item.id)).toEqual(["b4"]);
  });

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

describe("orderedReviewBlocks", () => {
  it("不丢块也不重复：长度等于输入，id 集合相同", () => {
    const blocks = loadFixtureBlocks("page-02.json");
    const ordered = orderedReviewBlocks(blocks);
    expect(ordered.length).toBe(blocks.length);
    expect(new Set(ordered.map((item) => item.id)).size).toBe(blocks.length);
  });

  it("分区连续：page-02 前 45 项为文字待确认、次 18 项为分类待确认、末 32 项为已一致", () => {
    const ordered = orderedReviewBlocks(loadFixtureBlocks("page-02.json"));
    const partitions = ordered.map(partitionOf);
    expect(new Set(partitions.slice(0, 45))).toEqual(new Set(["text-pending"]));
    expect(new Set(partitions.slice(45, 63))).toEqual(
      new Set(["classification-pending"]),
    );
    expect(new Set(partitions.slice(63))).toEqual(new Set(["agreed"]));
  });

  it("与 partitionBlocks 同源，保证列表顺序与键盘推进顺序一致", () => {
    const blocks = loadFixtureBlocks("page-01.json");
    expect(orderedReviewBlocks(blocks).map((item) => item.id)).toEqual(
      partitionBlocks(blocks).flatMap((group) =>
        group.blocks.map((item) => item.id),
      ),
    );
  });
});

describe("REVIEW_PARTITION_LABELS", () => {
  it("三分区都有中文标题", () => {
    expect(
      REVIEW_PARTITION_ORDER.map((key) => REVIEW_PARTITION_LABELS[key]),
    ).toEqual(["文字待确认", "分类待确认", "已一致"]);
  });
});
