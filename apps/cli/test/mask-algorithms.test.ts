import { describe, expect, it } from "vitest";
import {
  buildForegroundMask,
  connectedComponents,
  countMasked,
  dilate,
  filterSmallComponents,
  hexToRgb,
  pointInPolygon,
  type RgbaImage,
  rasterizeRegion,
  segmentBlockGlyphs,
} from "../src/mask/algorithms.js";

// 用逐像素颜色数组构造 RGBA 测试图。
function makeImage(pixels: number[][][]): RgbaImage {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = pixels[y]?.[x] ?? [0, 0, 0];
      const offset = (y * width + x) * 4;
      data[offset] = color[0] ?? 0;
      data[offset + 1] = color[1] ?? 0;
      data[offset + 2] = color[2] ?? 0;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function fullRegion(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height).fill(1);
}

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it("区分内外点", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
  });
});

describe("rasterizeRegion", () => {
  it("bbox 内为 1，bbox 外为 0", () => {
    const region = rasterizeRegion(
      6,
      6,
      { x: 1, y: 1, width: 2, height: 2 },
      null,
    );
    expect(region[1 * 6 + 1]).toBe(1);
    expect(region[2 * 6 + 2]).toBe(1);
    expect(region[0]).toBe(0);
    expect(region[5 * 6 + 5]).toBe(0);
  });

  it("有 quad 时限制到多边形内", () => {
    const region = rasterizeRegion(6, 6, { x: 0, y: 0, width: 6, height: 6 }, [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ]);
    expect(region[1 * 6 + 1]).toBe(1);
    expect(region[4 * 6 + 4]).toBe(0);
  });
});

describe("connectedComponents", () => {
  it("统计两个不相连的连通域", () => {
    const width = 5;
    const height = 5;
    const mask = new Uint8Array(width * height);
    // 左上 2x2 与右下单点两个 blob。
    mask[0] = 1;
    mask[1] = 1;
    mask[5] = 1;
    mask[6] = 1;
    mask[24] = 1;
    const result = connectedComponents(mask, width, height);
    expect(result.count).toBe(2);
    expect([...result.sizes].sort((a, b) => a - b)).toEqual([1, 4]);
  });
});

describe("dilate", () => {
  it("半径 1 的欧氏圆盘把单点扩成十字（5 像素）", () => {
    const width = 5;
    const height = 5;
    const mask = new Uint8Array(width * height);
    mask[2 * 5 + 2] = 1;
    const dilated = dilate(mask, width, height, 1);
    expect(countMasked(dilated)).toBe(5);
    expect(dilated[2 * 5 + 2]).toBe(1);
    expect(dilated[1 * 5 + 2]).toBe(1);
    expect(dilated[2 * 5 + 1]).toBe(1);
    expect(dilated[1 * 5 + 1]).toBe(0);
  });

  it("半径 0 不改变掩码", () => {
    const mask = new Uint8Array(9);
    mask[4] = 1;
    expect(dilate(mask, 3, 3, 0)).toEqual(mask);
  });
});

describe("filterSmallComponents", () => {
  it("剔除面积小于阈值的连通域", () => {
    const width = 5;
    const height = 5;
    const mask = new Uint8Array(width * height);
    mask[0] = 1;
    mask[1] = 1;
    mask[5] = 1; // 3 像素 blob
    mask[24] = 1; // 单点噪声
    const filtered = filterSmallComponents(mask, width, height, 2);
    expect(filtered[0]).toBe(1);
    expect(filtered[24]).toBe(0);
  });
});

describe("buildForegroundMask", () => {
  it("命中前景颜色候选的像素为前景", () => {
    const image = makeImage([
      [
        [0, 0, 0],
        [255, 255, 255],
      ],
    ]);
    const mask = buildForegroundMask(
      image,
      fullRegion(2, 1),
      [[255, 255, 255]],
      30,
    );
    expect(mask[0]).toBe(0);
    expect(mask[1]).toBe(1);
  });

  it("无前景候选时以背景色差判前景", () => {
    const image = makeImage([
      [
        [10, 10, 10],
        [10, 10, 10],
        [240, 240, 240],
      ],
    ]);
    const mask = buildForegroundMask(image, fullRegion(3, 1), [], 40);
    expect(mask[0]).toBe(0);
    expect(mask[2]).toBe(1);
  });
});

describe("segmentBlockGlyphs", () => {
  it("按颜色分割字形并用排除多边形保护对象内符号", () => {
    const width = 12;
    const height = 12;
    const pixels: number[][][] = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => [0, 0, 0]),
    );
    const paint = (x: number, y: number): void => {
      const row = pixels[y];
      if (row !== undefined) {
        row[x] = [255, 255, 255];
      }
    };
    // 字形：白色 3x3 在 (2,2)。
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        paint(x, y);
      }
    }
    // 对象内符号：白色 2x2 在 (8,8)，应被排除多边形保护。
    for (let y = 8; y <= 9; y += 1) {
      for (let x = 8; x <= 9; x += 1) {
        paint(x, y);
      }
    }
    const image = makeImage(pixels);
    const mask = segmentBlockGlyphs(image, {
      bbox: { x: 0, y: 0, width: 12, height: 12 },
      quad: null,
      foregroundColors: [[255, 255, 255]],
      colorTolerance: 30,
      edgeThreshold: 1,
      minComponentAreaPx: 1,
      dilationRadiusPx: 0,
      excludePolygons: [
        [
          { x: 7, y: 7 },
          { x: 11, y: 7 },
          { x: 11, y: 11 },
          { x: 7, y: 11 },
        ],
      ],
    });
    expect(countMasked(mask)).toBe(9);
    expect(mask[2 * 12 + 2]).toBe(1);
    expect(mask[8 * 12 + 8]).toBe(0);
  });
});

describe("hexToRgb", () => {
  it("解析 6 位十六进制颜色", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#fad16b")).toEqual([250, 209, 107]);
  });
  it("拒绝非法颜色", () => {
    expect(() => hexToRgb("red")).toThrow();
  });
});
