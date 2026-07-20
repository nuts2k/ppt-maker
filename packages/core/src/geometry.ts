import {
  PPTX_WIDE_HEIGHT_INCHES,
  PPTX_WIDE_WIDTH_INCHES,
  WIDE_ASPECT_RATIO,
  WIDE_ASPECT_RATIO_RELATIVE_TOLERANCE,
} from "./constants.js";
import { FoundationError } from "./errors.js";

export interface PixelDimensions {
  readonly width: number;
  readonly height: number;
}

export interface BoundingBoxPx {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AspectRatioValidation {
  readonly valid: boolean;
  readonly expected: number;
  readonly actual: number;
  readonly relativeError: number;
  readonly tolerance: number;
}

export interface SlideBoxInches {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FoundationError(
      "INVALID_DIMENSIONS",
      `${label} 必须是大于 0 的有限数值`,
      { [label]: value },
    );
  }
}

export function validateWideAspectRatio(
  dimensions: PixelDimensions,
  tolerance = WIDE_ASPECT_RATIO_RELATIVE_TOLERANCE,
): AspectRatioValidation {
  assertPositiveFinite(dimensions.width, "width");
  assertPositiveFinite(dimensions.height, "height");

  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new FoundationError(
      "INVALID_DIMENSIONS",
      "宽高比容差必须是大于或等于 0 的有限数值",
      { tolerance },
    );
  }

  const actual = dimensions.width / dimensions.height;
  const relativeError =
    Math.abs(actual - WIDE_ASPECT_RATIO) / WIDE_ASPECT_RATIO;

  return {
    valid: relativeError <= tolerance,
    expected: WIDE_ASPECT_RATIO,
    actual,
    relativeError,
    tolerance,
  };
}

export function assertWideAspectRatio(dimensions: PixelDimensions): void {
  const validation = validateWideAspectRatio(dimensions);
  if (!validation.valid) {
    throw new FoundationError(
      "INVALID_ASPECT_RATIO",
      "输入图片必须为 16:9，且不会自动裁剪、拉伸或补边",
      { ...validation },
    );
  }
}

export function pixelsToPptxBox(
  box: BoundingBoxPx,
  image: PixelDimensions,
): SlideBoxInches {
  assertPositiveFinite(image.width, "image.width");
  assertPositiveFinite(image.height, "image.height");

  const values = [box.x, box.y, box.width, box.height];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    throw new FoundationError(
      "INVALID_BOUNDING_BOX",
      "文字边界必须包含有效的正尺寸",
      {
        box,
      },
    );
  }

  if (
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > image.width ||
    box.y + box.height > image.height
  ) {
    throw new FoundationError(
      "INVALID_BOUNDING_BOX",
      "文字边界必须位于源图片范围内",
      {
        box,
        image,
      },
    );
  }

  return {
    x: (box.x / image.width) * PPTX_WIDE_WIDTH_INCHES,
    y: (box.y / image.height) * PPTX_WIDE_HEIGHT_INCHES,
    width: (box.width / image.width) * PPTX_WIDE_WIDTH_INCHES,
    height: (box.height / image.height) * PPTX_WIDE_HEIGHT_INCHES,
  };
}
