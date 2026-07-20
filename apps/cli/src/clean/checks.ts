import type { CleanPlateChecks, TextReviewBlock } from "@ppt-maker/core";
import sharp from "sharp";
import {
  buildForegroundMask,
  countMasked,
  dilate,
  hexToRgb,
  type Point,
  type RgbaImage,
  rasterizeRegion,
} from "../mask/algorithms.js";

// mask 外非文字误改的单通道判定阈值；容器紧邻环半径。
export const OUTSIDE_DIFF_THRESHOLD = 24;
export const CONTAINER_RING_RADIUS_PX = 8;

export interface CleanPlateCheckInput {
  readonly sourcePath: string;
  readonly cleanBuffer: Buffer;
  readonly maskPath: string;
  readonly maskBlocks: readonly TextReviewBlock[];
  readonly expectedWidth: number;
  readonly expectedHeight: number;
}

export interface CleanPlateCheckOutput {
  readonly checks: CleanPlateChecks;
  readonly diffPng: Buffer;
}

async function decodeRgba(input: string | Buffer): Promise<RgbaImage> {
  const decoded = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
  };
}

function pixelDelta(a: RgbaImage, b: RgbaImage, index: number): number {
  const offset = index * 4;
  const dr = Math.abs((a.data[offset] ?? 0) - (b.data[offset] ?? 0));
  const dg = Math.abs((a.data[offset + 1] ?? 0) - (b.data[offset + 1] ?? 0));
  const db = Math.abs((a.data[offset + 2] ?? 0) - (b.data[offset + 2] ?? 0));
  return Math.max(dr, dg, db);
}

export async function computeCleanPlateChecks(
  input: CleanPlateCheckInput,
): Promise<CleanPlateCheckOutput> {
  const source = await decodeRgba(input.sourcePath);
  const width = source.width;
  const height = source.height;

  // 结果尺寸/比例检查（在归一前用原始结果尺寸）。
  const cleanMeta = await sharp(input.cleanBuffer).metadata();
  const resultWidth = cleanMeta.width ?? 0;
  const resultHeight = cleanMeta.height ?? 0;
  const aspectRatioOk =
    resultHeight > 0 &&
    Math.abs(
      resultWidth / resultHeight - input.expectedWidth / input.expectedHeight,
    ) < 0.01;

  // 归一到源图尺寸后逐像素比对。
  const cleanResizedBuffer = await sharp(input.cleanBuffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const clean: RgbaImage = { data: cleanResizedBuffer, width, height };

  // mask.png：alpha=0 表示字形（待编辑）区域。
  const maskImage = await decodeRgba(input.maskPath);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    if ((maskImage.data[i * 4 + 3] ?? 255) === 0) {
      mask[i] = 1;
    }
  }
  const maskedPixels = countMasked(mask);

  // 文字残留：clean 结果在各块字形区域内仍匹配前景色的像素。
  let residualForegroundPixels = 0;
  for (const block of input.maskBlocks) {
    if (block.maskParams.foregroundColors.length === 0) {
      continue;
    }
    const region = rasterizeRegion(
      width,
      height,
      block.bboxPx,
      block.quadPx as readonly Point[] | null,
    );
    const foreground = buildForegroundMask(
      clean,
      region,
      block.maskParams.foregroundColors.map(hexToRgb),
      block.maskParams.colorTolerance,
    );
    for (let i = 0; i < width * height; i += 1) {
      if (foreground[i] === 1 && mask[i] === 1) {
        residualForegroundPixels += 1;
      }
    }
  }

  // mask 外差异 + 容器紧邻环差异。
  const ring = dilate(mask, width, height, CONTAINER_RING_RADIUS_PX);
  for (let i = 0; i < width * height; i += 1) {
    ring[i] = ring[i] === 1 && mask[i] === 0 ? 1 : 0;
  }
  let comparedPixels = 0;
  let changedPixels = 0;
  let deltaSum = 0;
  let ringPixels = 0;
  let ringChanged = 0;
  const diff = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    diff[offset] = source.data[offset] ?? 0;
    diff[offset + 1] = source.data[offset + 1] ?? 0;
    diff[offset + 2] = source.data[offset + 2] ?? 0;
    diff[offset + 3] = 255;
    if (mask[i] === 1) {
      continue;
    }
    const delta = pixelDelta(source, clean, i);
    comparedPixels += 1;
    deltaSum += delta;
    if (delta > OUTSIDE_DIFF_THRESHOLD) {
      changedPixels += 1;
      diff[offset] = 255;
      diff[offset + 1] = 0;
      diff[offset + 2] = 0;
    }
    if (ring[i] === 1) {
      ringPixels += 1;
      if (delta > OUTSIDE_DIFF_THRESHOLD) {
        ringChanged += 1;
      }
    }
  }

  const diffPng = await sharp(diff, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  const checks: CleanPlateChecks = {
    size: {
      width: resultWidth,
      height: resultHeight,
      expectedWidth: input.expectedWidth,
      expectedHeight: input.expectedHeight,
      ok:
        resultWidth === input.expectedWidth &&
        resultHeight === input.expectedHeight,
      aspectRatioOk,
    },
    textResidue: {
      maskedPixels,
      residualForegroundPixels,
      residualRatio:
        maskedPixels === 0 ? 0 : residualForegroundPixels / maskedPixels,
    },
    outsideMaskDiff: {
      comparedPixels,
      changedPixels,
      changedRatio: comparedPixels === 0 ? 0 : changedPixels / comparedPixels,
      meanDelta: comparedPixels === 0 ? 0 : deltaSum / comparedPixels,
      threshold: OUTSIDE_DIFF_THRESHOLD,
    },
    containerRingDiff: {
      ringPixels,
      changedPixels: ringChanged,
      changedRatio: ringPixels === 0 ? 0 : ringChanged / ringPixels,
    },
  };
  return { checks, diffPng };
}
