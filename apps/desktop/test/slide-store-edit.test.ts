/**
 * slide-store 的编辑写回逻辑测试。
 *
 * 断言落在 `lib/block-edit.ts` 的纯函数上而非 store 本身：store 经 ipc-client
 * 触碰 `window`，把它拉进 test 的类型图会让 tsconfig.node.json（lib 仅 ES2023、
 * 无 `@/*` 别名）解析失败。与 deck-store / todo-queue 的既有做法一致——
 * 逻辑放纯模块，store 只做状态装配。
 */

import type { TextReviewBlock } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  applyManualEdit,
  deleteBlockById,
  markBlocksReviewedById,
} from "../src/renderer/lib/block-edit.js";

type TextBlockSource = TextReviewBlock["sources"][number];

function source(
  kind: TextBlockSource["kind"],
  text: string,
  provider = kind,
): TextBlockSource {
  return { kind, provider, text, confidence: null };
}

function block(
  id: string,
  overrides: Partial<TextReviewBlock> = {},
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
    classification: "layout_text",
    sources: [source("offline_ocr", id), source("ai_text_assist", id)],
    includeInMask: true,
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
    ...overrides,
  };
}

function manualOf(target: TextReviewBlock): TextBlockSource[] {
  return target.sources.filter((item) => item.kind === "manual");
}

const NOW = "2026-07-26T10:00:00.000Z";
const LATER = "2026-07-26T10:05:00.000Z";

describe("applyManualEdit", () => {
  it("改文本时写 updatedAt 并追加 manual 来源", () => {
    const edited = applyManualEdit(block("a"), { text: "象征洁净高雅" }, NOW);
    expect(edited.text).toBe("象征洁净高雅");
    expect(edited.updatedAt).toBe(NOW);
    expect(manualOf(edited)).toEqual([
      {
        kind: "manual",
        provider: "desktop-review",
        text: "象征洁净高雅",
        confidence: null,
      },
    ]);
  });

  it("连续编辑同一块时 manual 条目仍只有一条，取最后一次的值", () => {
    const first = applyManualEdit(block("a"), { text: "第一次" }, NOW);
    const second = applyManualEdit(first, { text: "第二次" }, LATER);
    expect(manualOf(second)).toHaveLength(1);
    expect(manualOf(second)[0]?.text).toBe("第二次");
    expect(second.updatedAt).toBe(LATER);
  });

  it("编辑成空串时不写 manual 条目（schema 的 text 要求非空）", () => {
    const edited = applyManualEdit(block("a"), { text: "" }, NOW);
    expect(manualOf(edited)).toHaveLength(0);
    expect(edited.updatedAt).toBe(NOW);
  });

  it("已有 manual 条目被清空文本时移除该条目", () => {
    const first = applyManualEdit(block("a"), { text: "改过" }, NOW);
    const cleared = applyManualEdit(first, { text: "" }, LATER);
    expect(manualOf(cleared)).toHaveLength(0);
  });

  it("只改分类时 manual 来源的 text 取块当前文本", () => {
    const edited = applyManualEdit(
      block("a", { text: "历史脉络", classification: "layout_text" }),
      { classification: "object_integrated_symbol" },
      NOW,
    );
    expect(edited.classification).toBe("object_integrated_symbol");
    expect(manualOf(edited)[0]?.text).toBe("历史脉络");
  });

  it("不隐式改动 reviewStatus，由 patch 显式控制", () => {
    const untouched = applyManualEdit(block("a"), { text: "x" }, NOW);
    expect(untouched.reviewStatus).toBe("unreviewed");
    const explicit = applyManualEdit(
      block("a"),
      { text: "x", reviewStatus: "reviewed" },
      NOW,
    );
    expect(explicit.reviewStatus).toBe("reviewed");
  });

  it("保留 offline_ocr / ai_text_assist 来源与原顺序（分区判据依赖它们）", () => {
    const edited = applyManualEdit(block("a"), { text: "改过" }, NOW);
    expect(edited.sources.map((item) => item.kind)).toEqual([
      "offline_ocr",
      "ai_text_assist",
      "manual",
    ]);
  });

  it("不改动原块（调用方可能仍持有旧引用做对比）", () => {
    const original = block("a");
    applyManualEdit(original, { text: "改过" }, NOW);
    expect(original.text).toBe("a");
    expect(original.updatedAt).toBeNull();
    expect(manualOf(original)).toHaveLength(0);
  });
});

describe("markBlocksReviewedById", () => {
  it("只推进命中的块，且不写 updatedAt / manual 来源", () => {
    const blocks = [block("a"), block("b")];
    const result = markBlocksReviewedById(blocks, ["a"]);
    expect(result.changed).toBe(1);
    expect(result.blocks[0]?.reviewStatus).toBe("reviewed");
    expect(result.blocks[0]?.updatedAt).toBeNull();
    expect(manualOf(result.blocks[0] as TextReviewBlock)).toHaveLength(0);
    expect(result.blocks[1]?.reviewStatus).toBe("unreviewed");
  });

  it("保留已有 updatedAt，不因确认而刷新", () => {
    const blocks = [block("a", { updatedAt: NOW })];
    const result = markBlocksReviewedById(blocks, ["a"]);
    expect(result.blocks[0]?.updatedAt).toBe(NOW);
  });

  it("无命中或已复核时原样返回同一引用", () => {
    const blocks = [block("a", { reviewStatus: "reviewed" }), block("b")];
    expect(markBlocksReviewedById(blocks, ["a"]).blocks).toBe(blocks);
    expect(markBlocksReviewedById(blocks, ["missing"]).changed).toBe(0);
  });

  it("不覆盖 accepted_with_risk（它带着 riskAcceptance 记录，语义不同）", () => {
    const blocks = [block("a", { reviewStatus: "accepted_with_risk" })];
    const result = markBlocksReviewedById(blocks, ["a"]);
    expect(result.changed).toBe(0);
    expect(result.blocks[0]?.reviewStatus).toBe("accepted_with_risk");
  });

  it("覆盖真实场景：已一致分区 32 块一次全部通过", () => {
    const blocks = Array.from({ length: 32 }, (_, i) => block(`agreed-${i}`));
    const ids = blocks.map((item) => item.id);
    const result = markBlocksReviewedById(blocks, ids);
    expect(result.changed).toBe(32);
    expect(
      result.blocks.every(
        (item) =>
          item.reviewStatus === "reviewed" &&
          item.updatedAt === null &&
          manualOf(item).length === 0,
      ),
    ).toBe(true);
  });
});

describe("deleteBlockById", () => {
  it("删除命中的块并报告 deleted", () => {
    const blocks = [block("a"), block("b")];
    const result = deleteBlockById(blocks, "a");
    expect(result.deleted).toBe(true);
    expect(result.blocks.map((item) => item.id)).toEqual(["b"]);
  });

  it("id 不存在时原样返回同一引用，调用方据此不置 dirty", () => {
    const blocks = [block("a")];
    const result = deleteBlockById(blocks, "missing");
    expect(result.deleted).toBe(false);
    expect(result.blocks).toBe(blocks);
  });

  it("不改动原数组", () => {
    const blocks = [block("a"), block("b")];
    deleteBlockById(blocks, "a");
    expect(blocks).toHaveLength(2);
  });
});
