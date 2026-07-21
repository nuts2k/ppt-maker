import sharp from "sharp";
import type { TextReviewBlock } from "@ppt-maker/core";

export interface SampleColorInput {
  readonly sourcePath: string;
  readonly maskPath: string;
  readonly blocks: readonly TextReviewBlock[];
  readonly imageWidth: number;
  readonly imageHeight: number;
}

export async function sampleBlockColors(
  input: SampleColorInput,
): Promise<Map<string, string>> {
  const colors = new Map<string, string>();
  const needsSampling = input.blocks.filter(
    (b) => b.style.colorHex === null && b.includeInMask,
  );
  if (needsSampling.length === 0) return colors;

  const sourceImage = sharp(input.sourcePath);
  const maskImage = sharp(input.maskPath);
  const sourceMeta = await sourceImage.metadata();
  const maskMeta = await maskImage.metadata();
  if (!sourceMeta.width || !sourceMeta.height) return colors;
  if (!maskMeta.width || !maskMeta.height) return colors;

  for (const block of needsSampling) {
    const hex = await sampleBlockColor(
      input.sourcePath,
      input.maskPath,
      block.bboxPx,
      sourceMeta.width,
      sourceMeta.height,
      maskMeta.width,
      maskMeta.height,
    );
    if (hex !== null) {
      colors.set(block.id, hex);
    }
  }
  return colors;
}

async function sampleBlockColor(
  sourcePath: string,
  maskPath: string,
  bbox: { x: number; y: number; width: number; height: number },
  srcW: number,
  srcH: number,
  maskW: number,
  maskH: number,
): Promise<string | null> {
  const left = Math.max(0, Math.round(bbox.x));
  const top = Math.max(0, Math.round(bbox.y));
  const width = Math.min(Math.round(bbox.width), srcW - left);
  const height = Math.min(Math.round(bbox.height), srcH - top);
  if (width <= 0 || height <= 0) return null;

  const maskLeft = Math.max(0, Math.round((bbox.x / srcW) * maskW));
  const maskTop = Math.max(0, Math.round((bbox.y / srcH) * maskH));
  const maskWidth = Math.min(
    Math.round((bbox.width / srcW) * maskW),
    maskW - maskLeft,
  );
  const maskHeight = Math.min(
    Math.round((bbox.height / srcH) * maskH),
    maskH - maskTop,
  );
  if (maskWidth <= 0 || maskHeight <= 0) return null;

  const [srcRegion, maskRegion] = await Promise.all([
    sharp(sourcePath)
      .extract({ left, top, width, height })
      .resize(maskWidth, maskHeight, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer(),
    sharp(maskPath)
      .extract({
        left: maskLeft,
        top: maskTop,
        width: maskWidth,
        height: maskHeight,
      })
      .ensureAlpha()
      .raw()
      .toBuffer(),
  ]);

  const pixelCount = maskWidth * maskHeight;
  const rValues: number[] = [];
  const gValues: number[] = [];
  const bValues: number[] = [];

  for (let i = 0; i < pixelCount; i++) {
    const maskAlpha = maskRegion[i * 4 + 3];
    if (maskAlpha === undefined || maskAlpha > 0) continue;
    const r = srcRegion[i * 4];
    const g = srcRegion[i * 4 + 1];
    const b = srcRegion[i * 4 + 2];
    if (r === undefined || g === undefined || b === undefined) continue;
    rValues.push(r);
    gValues.push(g);
    bValues.push(b);
  }

  if (rValues.length < 3) return null;

  const median = (arr: number[]): number => {
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 === 0 ? (arr[mid - 1]! + arr[mid]!) >> 1 : arr[mid]!;
  };

  const r = median(rValues);
  const g = median(gValues);
  const b = median(bValues);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
