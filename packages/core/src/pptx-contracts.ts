import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";

const SHA256 = /^[a-f0-9]{64}$/;

// PPTX 自动检查（design §11）：ZIP/XML 结构、16:9 版面、文字内容、字体声明、形状数量。
// 自动检查不冒充 PowerPoint 人工验收；最终门是 accept-pptx。
export const PptxCheckReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  status: z.enum(["passed", "failed"]),
  checks: z.array(
    z.object({
      id: z.string().min(1),
      status: z.enum(["passed", "failed"]),
      message: z.string().min(1),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  layout: z.object({
    widthEmu: z.number().int().nonnegative(),
    heightEmu: z.number().int().nonnegative(),
    aspectRatioOk: z.boolean(),
  }),
  shapes: z.object({
    images: z.number().int().nonnegative(),
    textBoxes: z.number().int().nonnegative(),
    expectedTextBoxes: z.number().int().nonnegative(),
  }),
  fontFace: z.string().min(1),
  fontDeclared: z.boolean(),
  missingTexts: z.array(z.string()),
});

export const PptxSynthesisRecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  attemptId: z.string().min(1),
  cleanPlateSha256: z.string().regex(SHA256),
  reviewDocumentSha256: z.string().regex(SHA256),
  fontFace: z.string().min(1),
  // 是否使用了微软雅黑以外的显式备用字体（design §11 要求记录偏离）。
  fontFallback: z.boolean(),
  textBoxCount: z.number().int().nonnegative(),
  resultSha256: z.string().regex(SHA256),
  checkSha256: z.string().regex(SHA256),
  checkStatus: z.enum(["passed", "failed"]),
});

export type PptxCheckReport = z.infer<typeof PptxCheckReportSchema>;
export type PptxSynthesisRecord = z.infer<typeof PptxSynthesisRecordSchema>;
