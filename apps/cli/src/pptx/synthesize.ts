import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_FONT_FACE,
  PPTX_WIDE_HEIGHT_INCHES,
  PPTX_WIDE_WIDTH_INCHES,
  pixelsToPptxBox,
  resolveFontSizePt,
  type TextReviewBlock,
  toAlign,
  toBold,
  toValign,
} from "@ppt-maker/core";
import * as PptxGenJSModule from "pptxgenjs";

// 字号与对齐公式已迁至 core（design §4.3），此处重新导出以保持既有导入路径。
export {
  fontSizePtFromPx,
  resolveFontSizePt,
  toAlign,
  toBold,
  toValign,
} from "@ppt-maker/core";

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

export function normalizeRotation(rotationDeg: number): number {
  const wrapped = rotationDeg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export interface SynthesizePptxInput {
  readonly cleanPlatePath: string;
  readonly outputPath: string;
  readonly blocks: readonly TextReviewBlock[];
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly fontFace: string;
}

export interface SynthesizePptxResult {
  readonly outputPath: string;
  readonly textContents: string[];
  readonly textBoxCount: number;
  readonly fontFace: string;
}

// 用已接受 clean plate 作全页背景，为已复核 layout_text 块生成微软雅黑原生文本框。
export async function synthesizePptx(
  input: SynthesizePptxInput,
): Promise<SynthesizePptxResult> {
  const outputPath = resolve(input.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "PPT Maker";
  pptx.subject = "M1 single slide";
  pptx.title = "PPT Maker M1 Slide";
  pptx.company = "PPT Maker";
  pptx.lang = "zh-CN";

  const slide = pptx.addSlide();
  slide.addImage({
    path: resolve(input.cleanPlatePath),
    x: 0,
    y: 0,
    w: PPTX_WIDE_WIDTH_INCHES,
    h: PPTX_WIDE_HEIGHT_INCHES,
  });

  const image = { width: input.imageWidth, height: input.imageHeight };
  const ordered = [...input.blocks].sort((a, b) => a.zIndex - b.zIndex);
  const textContents: string[] = [];
  for (const block of ordered) {
    const box = pixelsToPptxBox(block.bboxPx, image);
    const text = block.lines.length > 0 ? block.lines.join("\n") : block.text;
    textContents.push(text);
    const rotate = normalizeRotation(block.rotationDeg);
    const options: TextOptions = {
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
      fontFace: input.fontFace,
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

  await pptx.writeFile({ fileName: outputPath });
  return {
    outputPath,
    textContents,
    textBoxCount: ordered.length,
    fontFace: input.fontFace,
  };
}

export const PPTX_DEFAULT_FONT_FACE = DEFAULT_FONT_FACE;
