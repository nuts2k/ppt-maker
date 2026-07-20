import { readFile } from "node:fs/promises";
import {
  assertWideAspectRatio,
  validateWideAspectRatio,
} from "@ppt-maker/core";
import { imageSize } from "image-size";

export interface ImageMetadata {
  readonly path: string;
  readonly type: string;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: ReturnType<typeof validateWideAspectRatio>;
}

export async function readImageMetadata(path: string): Promise<ImageMetadata> {
  const buffer = await readFile(path);
  const dimensions = imageSize(buffer);

  if (!dimensions.width || !dimensions.height || !dimensions.type) {
    throw new Error(`无法读取图片尺寸或格式：${path}`);
  }

  const metadata = {
    path,
    type: dimensions.type,
    width: dimensions.width,
    height: dimensions.height,
    aspectRatio: validateWideAspectRatio({
      width: dimensions.width,
      height: dimensions.height,
    }),
  };

  return metadata;
}

export async function assertWideImage(path: string): Promise<ImageMetadata> {
  const metadata = await readImageMetadata(path);
  assertWideAspectRatio(metadata);
  return metadata;
}
