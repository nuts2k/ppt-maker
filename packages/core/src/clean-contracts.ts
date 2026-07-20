import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";

const SHA256 = /^[a-f0-9]{64}$/;

// clean plate 离线辅助检查（design §10）：输出尺寸/比例、文字残留、mask 外误改、容器完整性。
// 全部为可检查数值，不冒充人工验收；质量判断仍由开发者复核后 accept-clean。
export const CleanPlateChecksSchema = z.object({
  size: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    expectedWidth: z.number().int().positive(),
    expectedHeight: z.number().int().positive(),
    ok: z.boolean(),
    aspectRatioOk: z.boolean(),
  }),
  // 文字残留：在原 mask 字形区域内，clean 结果仍匹配前景色的像素数。
  textResidue: z.object({
    maskedPixels: z.number().int().nonnegative(),
    residualForegroundPixels: z.number().int().nonnegative(),
    residualRatio: z.number().min(0),
  }),
  // mask 外差异：非字形区域应与源图一致（尺寸归一后比对）。
  outsideMaskDiff: z.object({
    comparedPixels: z.number().int().nonnegative(),
    changedPixels: z.number().int().nonnegative(),
    changedRatio: z.number().min(0),
    meanDelta: z.number().min(0),
    threshold: z.number().int().nonnegative(),
  }),
  // 容器完整性：字形四周紧邻环（容器填充/边框所在）应基本不变。
  containerRingDiff: z.object({
    ringPixels: z.number().int().nonnegative(),
    changedPixels: z.number().int().nonnegative(),
    changedRatio: z.number().min(0),
  }),
});

export const CleanAttemptRecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  attemptId: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  size: z.string().min(1),
  quality: z.string().min(1),
  outputFormat: z.string().min(1),
  sourceImageSha256: z.string().regex(SHA256),
  maskSha256: z.string().regex(SHA256),
  reviewDocumentSha256: z.string().regex(SHA256),
  resultSha256: z.string().regex(SHA256),
  requestId: z.string().min(1).nullable(),
  usage: z.record(z.string(), z.unknown()).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  checks: CleanPlateChecksSchema,
});

export type CleanPlateChecks = z.infer<typeof CleanPlateChecksSchema>;
export type CleanAttemptRecord = z.infer<typeof CleanAttemptRecordSchema>;
