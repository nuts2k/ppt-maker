import { type PptxCheckReport, SCHEMA_VERSION } from "@ppt-maker/core";
import JSZip from "jszip";

const WIDE_RATIO = 16 / 9;

export interface PptxCheckInput {
  readonly pptxBuffer: Buffer;
  readonly expectedTexts: readonly string[];
  readonly fontFace: string;
  readonly expectedTextBoxes: number;
}

function countMatches(haystack: string, pattern: RegExp): number {
  return haystack.match(pattern)?.length ?? 0;
}

function unescapeXml(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"');
}

// 解析 pptx（ZIP/XML）并校验版面 16:9、文字内容、字体声明与形状数量。
export async function checkPptx(
  input: PptxCheckInput,
): Promise<PptxCheckReport> {
  const checks: PptxCheckReport["checks"] = [];
  const zip = await JSZip.loadAsync(input.pptxBuffer);

  const contentTypes = zip.file("[Content_Types].xml");
  const presentationXml = await zip
    .file("ppt/presentation.xml")
    ?.async("string");
  const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");

  const zipOk =
    contentTypes !== null &&
    presentationXml !== undefined &&
    slideXml !== undefined;
  checks.push({
    id: "zip-structure",
    status: zipOk ? "passed" : "failed",
    message: zipOk
      ? "包含 [Content_Types].xml、presentation.xml 与 slide1.xml"
      : "PPTX ZIP 结构缺少必要 OOXML 部件",
  });

  const xmlOk =
    (presentationXml?.includes("<p:presentation") ?? false) &&
    (slideXml?.startsWith("<?xml") ?? false) &&
    (slideXml?.includes("<p:sld") ?? false);
  checks.push({
    id: "xml-parse",
    status: xmlOk ? "passed" : "failed",
    message: xmlOk ? "slide/presentation XML 结构有效" : "XML 根元素缺失",
  });

  const sldSz = presentationXml?.match(
    /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/u,
  );
  const widthEmu = sldSz ? Number(sldSz[1]) : 0;
  const heightEmu = sldSz ? Number(sldSz[2]) : 0;
  const aspectRatioOk =
    heightEmu > 0 && Math.abs(widthEmu / heightEmu - WIDE_RATIO) < 0.01;
  checks.push({
    id: "aspect-ratio",
    status: aspectRatioOk ? "passed" : "failed",
    message: aspectRatioOk
      ? "版面为 16:9"
      : `版面比例不符：${widthEmu}x${heightEmu} EMU`,
    details: { widthEmu, heightEmu },
  });

  const slideText = slideXml ?? "";
  const runTexts = [...slideText.matchAll(/<a:t>([^<]*)<\/a:t>/gu)]
    .map((match) => unescapeXml(match[1] ?? ""))
    .join("\n");
  const missingTexts: string[] = [];
  for (const expected of input.expectedTexts) {
    const lines = expected.split("\n").filter((line) => line.trim().length > 0);
    const present = lines.every((line) => runTexts.includes(line));
    if (!present) {
      missingTexts.push(expected);
    }
  }
  checks.push({
    id: "text-content",
    status: missingTexts.length === 0 ? "passed" : "failed",
    message:
      missingTexts.length === 0
        ? "全部目标文字内容存在于原生文本层"
        : `缺失目标文字：${missingTexts.length} 项`,
    details: { missingTexts },
  });

  const fontDeclared =
    input.expectedTextBoxes === 0 ||
    slideText.includes(`typeface="${input.fontFace}"`);
  checks.push({
    id: "font-declaration",
    status: fontDeclared ? "passed" : "failed",
    message: fontDeclared
      ? `字体声明为 ${input.fontFace}`
      : `未声明字体 ${input.fontFace}`,
  });

  const images = countMatches(slideText, /<p:pic>/gu);
  const textBoxes = countMatches(slideText, /<p:sp>/gu);
  const shapesOk = images === 1 && textBoxes === input.expectedTextBoxes;
  checks.push({
    id: "shape-count",
    status: shapesOk ? "passed" : "failed",
    message: shapesOk
      ? `背景图 1 + 文本框 ${textBoxes}`
      : `形状数量不符：图片 ${images}，文本框 ${textBoxes}（期望 ${input.expectedTextBoxes}）`,
    details: { images, textBoxes, expectedTextBoxes: input.expectedTextBoxes },
  });

  const status = checks.every((check) => check.status === "passed")
    ? "passed"
    : "failed";
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    checks,
    layout: { widthEmu, heightEmu, aspectRatioOk },
    shapes: {
      images,
      textBoxes,
      expectedTextBoxes: input.expectedTextBoxes,
    },
    fontFace: input.fontFace,
    fontDeclared,
    missingTexts,
  };
}
