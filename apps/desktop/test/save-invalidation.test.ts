/**
 * 保存复核的失效粒度判据。
 *
 * 夹具复用 `fixtures/review-partition/page-01.json`（复制自真实工作区），
 * 保证判据跑在真实文档结构上，而不是手搓的极简对象。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type TextReviewDocument,
  TextReviewDocumentSchema,
} from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { decideInvalidation } from "../src/main/save-invalidation.js";

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/review-partition/page-01.json",
);

function loadDocument(): TextReviewDocument {
  return TextReviewDocumentSchema.parse(
    JSON.parse(readFileSync(fixturePath, "utf8")),
  );
}

function edited(
  mutate: (document: TextReviewDocument) => void,
): TextReviewDocument {
  const copy = loadDocument();
  mutate(copy);
  return TextReviewDocumentSchema.parse(copy);
}

describe("decideInvalidation", () => {
  it("旧文档不存在时不失效任何阶段", () => {
    expect(decideInvalidation(null, loadDocument())).toBeNull();
  });

  it("文档完全相同时不失效任何阶段（空保存不得触发 clean 的付费重跑）", () => {
    expect(decideInvalidation(loadDocument(), loadDocument())).toBeNull();
  });

  it("改分类会改变 mask 投影，失效到 mask", () => {
    const previous = loadDocument();
    const next = edited((document) => {
      const target = document.blocks[0];
      if (target === undefined) throw new Error("夹具缺少块");
      target.classification =
        target.classification === "layout_text"
          ? "object_integrated_symbol"
          : "layout_text";
      target.includeInMask = target.classification === "layout_text";
    });
    expect(decideInvalidation(previous, next)).toBe("mask");
  });

  it("改 maskParams 同样失效到 mask", () => {
    const previous = loadDocument();
    const next = edited((document) => {
      const target = document.blocks[0];
      if (target === undefined) throw new Error("夹具缺少块");
      target.maskParams.colorTolerance = target.maskParams.colorTolerance + 1;
    });
    expect(decideInvalidation(previous, next)).toBe("mask");
  });

  it("只改文字内容时 mask 投影不变，仅失效到 pptx", () => {
    const previous = loadDocument();
    const next = edited((document) => {
      const target = document.blocks[0];
      if (target === undefined) throw new Error("夹具缺少块");
      target.text = `${target.text}（改）`;
    });
    expect(decideInvalidation(previous, next)).toBe("pptx");
  });

  it("只改复核状态时也失效到 pptx（与 pptx 自身的整份文档指纹口径一致）", () => {
    const previous = loadDocument();
    const next = edited((document) => {
      const target = document.blocks[0];
      if (target === undefined) throw new Error("夹具缺少块");
      target.reviewStatus =
        target.reviewStatus === "reviewed" ? "unreviewed" : "reviewed";
    });
    expect(decideInvalidation(previous, next)).toBe("pptx");
  });
});
