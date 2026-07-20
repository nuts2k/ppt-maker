import { describe, expect, it } from "vitest";
import {
  FoundationError,
  PPTX_WIDE_HEIGHT_INCHES,
  PPTX_WIDE_WIDTH_INCHES,
  pixelsToPptxBox,
  validateWideAspectRatio,
} from "../src/index.js";

describe("validateWideAspectRatio", () => {
  it("接受标准 16:9 图片", () => {
    const result = validateWideAspectRatio({ width: 1920, height: 1080 });
    expect(result.valid).toBe(true);
    expect(result.relativeError).toBe(0);
  });

  it("拒绝明显不同的比例", () => {
    const result = validateWideAspectRatio({ width: 1600, height: 1200 });
    expect(result.valid).toBe(false);
  });

  it("拒绝无效尺寸", () => {
    expect(() => validateWideAspectRatio({ width: 0, height: 1080 })).toThrow(
      FoundationError,
    );
  });
});

describe("pixelsToPptxBox", () => {
  it("将整页像素映射到标准 wide 页面", () => {
    const result = pixelsToPptxBox(
      { x: 0, y: 0, width: 1920, height: 1080 },
      { width: 1920, height: 1080 },
    );

    expect(result).toEqual({
      x: 0,
      y: 0,
      width: PPTX_WIDE_WIDTH_INCHES,
      height: PPTX_WIDE_HEIGHT_INCHES,
    });
  });

  it("拒绝越界边界", () => {
    expect(() =>
      pixelsToPptxBox(
        { x: 1800, y: 100, width: 200, height: 100 },
        { width: 1920, height: 1080 },
      ),
    ).toThrow(FoundationError);
  });
});
