import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PPTX_WIDE_HEIGHT_INCHES,
  PPTX_WIDE_WIDTH_INCHES,
  pixelsToPptxBox,
  type TextReviewBlock,
} from "@ppt-maker/core";
import * as PptxGenJSModule from "pptxgenjs";
import {
  normalizeRotation,
  resolveFontSizePt,
  toAlign,
  toBold,
  toValign,
} from "./synthesize.js";

interface TextOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  fontFace: string;
  fontSize: number;
  color: string;
  bold: boolean;
  align: "left" | "center" | "right";
  valign: "top" | "middle";
  margin: number;
  rotate?: number;
  lineSpacingMultiple?: number;
  fill?: { color: string; transparency?: number };
}

interface SynthSlide {
  addImage(options: {
    path: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }): unknown;
  addText(text: string, options: TextOptions): unknown;
}

interface SynthPresentation {
  layout: string;
  author: string;
  subject: string;
  title: string;
  company: string;
  lang: string;
  addSlide(): SynthSlide;
  writeFile(options: { fileName: string }): Promise<string>;
}

const PptxGenJS =
  PptxGenJSModule.default as unknown as new () => SynthPresentation;

const PLACEHOLDER_LABEL = "待完成";

export interface DeckSlideInput {
  readonly type: "native" | "placeholder";
  readonly cleanPlatePath?: string;
  readonly blocks?: readonly TextReviewBlock[];
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly sourcePath: string;
  readonly pageLabel: string;
}

export interface SynthesizeDeckPptxResult {
  readonly outputPath: string;
  readonly totalSlides: number;
  readonly nativeSlides: number;
  readonly placeholderSlides: number;
}

function addNativeSlide(
  pptx: SynthPresentation,
  input: DeckSlideInput,
  fontFace: string,
): void {
  const slide = pptx.addSlide();
  slide.addImage({
    path: resolve(input.cleanPlatePath ?? input.sourcePath),
    x: 0,
    y: 0,
    w: PPTX_WIDE_WIDTH_INCHES,
    h: PPTX_WIDE_HEIGHT_INCHES,
  });

  const image = { width: input.imageWidth, height: input.imageHeight };
  const ordered = [...(input.blocks ?? [])].sort((a, b) => a.zIndex - b.zIndex);
  for (const block of ordered) {
    const box = pixelsToPptxBox(block.bboxPx, image);
    const text = block.lines.length > 0 ? block.lines.join("\n") : block.text;
    const rotate = normalizeRotation(block.rotationDeg);
    const options: TextOptions = {
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
      fontFace,
      fontSize: resolveFontSizePt(block, input.imageWidth),
      color: (block.style.colorHex ?? "#333333").replace("#", "").toUpperCase(),
      bold: toBold(block.style.fontWeight),
      align: toAlign(block.style.horizontalAlign),
      valign: toValign(block.style.verticalAlign),
      margin: 0,
      ...(rotate === 0 ? {} : { rotate }),
      ...(block.style.lineHeight === null
        ? {}
        : { lineSpacingMultiple: block.style.lineHeight }),
    };
    slide.addText(text, options);
  }
}

function addPlaceholderSlide(
  pptx: SynthPresentation,
  input: DeckSlideInput,
  fontFace: string,
): void {
  const slide = pptx.addSlide();
  slide.addImage({
    path: resolve(input.sourcePath),
    x: 0,
    y: 0,
    w: PPTX_WIDE_WIDTH_INCHES,
    h: PPTX_WIDE_HEIGHT_INCHES,
  });

  const labelWidth = 6;
  const labelHeight = 1.5;
  slide.addText(PLACEHOLDER_LABEL, {
    x: (PPTX_WIDE_WIDTH_INCHES - labelWidth) / 2,
    y: (PPTX_WIDE_HEIGHT_INCHES - labelHeight) / 2,
    w: labelWidth,
    h: labelHeight,
    fontFace,
    fontSize: 36,
    color: "000000",
    bold: true,
    align: "center",
    valign: "middle",
    margin: 0,
    fill: { color: "FFFFFF", transparency: 30 },
  });
}

export async function synthesizeDeckPptx(input: {
  readonly slides: DeckSlideInput[];
  readonly outputPath: string;
  readonly fontFace: string;
  readonly deckName: string;
}): Promise<SynthesizeDeckPptxResult> {
  const outputPath = resolve(input.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "PPT Maker";
  pptx.subject = input.deckName;
  pptx.title = input.deckName;
  pptx.company = "PPT Maker";
  pptx.lang = "zh-CN";

  let nativeSlides = 0;
  let placeholderSlides = 0;
  for (const slide of input.slides) {
    if (slide.type === "native") {
      addNativeSlide(pptx, slide, input.fontFace);
      nativeSlides += 1;
    } else {
      addPlaceholderSlide(pptx, slide, input.fontFace);
      placeholderSlides += 1;
    }
  }

  await pptx.writeFile({ fileName: outputPath });
  return {
    outputPath,
    totalSlides: input.slides.length,
    nativeSlides,
    placeholderSlides,
  };
}
