import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_FONT_FACE,
  PPTX_WIDE_HEIGHT_INCHES,
  PPTX_WIDE_WIDTH_INCHES,
} from "@ppt-maker/core";
import * as PptxGenJSModule from "pptxgenjs";
import { assertWideImage } from "./image.js";

interface ProbeSlide {
  addImage(options: {
    path: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }): unknown;
  addText(
    text: string,
    options: {
      x: number;
      y: number;
      w: number;
      h: number;
      fontFace: string;
      fontSize: number;
      color: string;
      bold: boolean;
      margin: number;
      align: "center";
      valign: "mid";
    },
  ): unknown;
}

interface ProbePresentation {
  layout: string;
  author: string;
  subject: string;
  title: string;
  company: string;
  lang: string;
  addSlide(): ProbeSlide;
  writeFile(options: { fileName: string }): Promise<string>;
}

// PptxGenJS 4 的 NodeNext 类型导出会被 TypeScript 识别为模块命名空间，
// 运行时默认导出实际是构造函数。这里把边界收窄到探针使用的最小接口。
const PptxGenJS =
  PptxGenJSModule.default as unknown as new () => ProbePresentation;

export interface PptxProbeOptions {
  readonly imagePath: string;
  readonly outputPath: string;
  readonly fontFace?: string;
}

export async function createPptxProbe(
  options: PptxProbeOptions,
): Promise<string> {
  await assertWideImage(options.imagePath);
  const outputPath = resolve(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "PPT Maker";
  pptx.subject = "M0 project foundation probe";
  pptx.title = "PPT Maker M0 Probe";
  pptx.company = "PPT Maker";
  pptx.lang = "zh-CN";

  const slide = pptx.addSlide();
  slide.addImage({
    path: resolve(options.imagePath),
    x: 0,
    y: 0,
    w: PPTX_WIDE_WIDTH_INCHES,
    h: PPTX_WIDE_HEIGHT_INCHES,
  });
  slide.addText("你好，PPT Maker / Editable Text", {
    x: 1,
    y: 5.75,
    w: 11.333,
    h: 0.65,
    fontFace: options.fontFace ?? DEFAULT_FONT_FACE,
    fontSize: 24,
    color: "FFFFFF",
    bold: true,
    margin: 0,
    align: "center",
    valign: "mid",
  });

  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}
