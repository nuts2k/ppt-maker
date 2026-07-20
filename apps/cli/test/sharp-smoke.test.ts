import sharp from "sharp";
import { describe, expect, it } from "vitest";

// 固定 mask 阶段依赖的 sharp 解码→raw 像素 buffer→编码 PNG 链路，
// 确保平台预编译包（@img/sharp-darwin-arm64）可用且像素级往返确定。
describe("sharp 像素往返冒烟", () => {
  it("平台包已加载", () => {
    expect(sharp.versions.sharp).toBe("0.35.3");
  });

  it("decode → raw RGBA buffer → encode PNG 往返字节确定", async () => {
    const width = 4;
    const height = 2;
    const channels = 4;
    // 已知像素：红、绿、蓝、半透明白，逐像素铺满两行。
    const source = Buffer.alloc(width * height * channels);
    const palette = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 128],
    ];
    for (let i = 0; i < width * height; i += 1) {
      const color = palette[i % palette.length];
      if (color === undefined) {
        continue;
      }
      source.set(color, i * channels);
    }

    const encodedPng = await sharp(source, {
      raw: { width, height, channels },
    })
      .png()
      .toBuffer();

    const decoded = await sharp(encodedPng)
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(decoded.info.width).toBe(width);
    expect(decoded.info.height).toBe(height);
    expect(decoded.info.channels).toBe(channels);
    expect(Buffer.compare(decoded.data, source)).toBe(0);

    // 二次编码→解码验证链路稳定（无累积漂移）。
    const reEncoded = await sharp(decoded.data, {
      raw: { width, height, channels },
    })
      .png()
      .toBuffer();
    const reDecoded = await sharp(reEncoded)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Buffer.compare(reDecoded.data, source)).toBe(0);
  });

  it("保留 alpha 通道输出带透明度的 PNG", async () => {
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const metadata = await sharp(png).metadata();
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.format).toBe("png");
  });
});
