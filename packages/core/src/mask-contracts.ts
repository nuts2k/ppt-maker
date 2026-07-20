import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";

const SHA256 = /^[a-f0-9]{64}$/;

// 自动 mask 算法版本，纳入 mask 阶段输入指纹；算法演进使 mask 及下游失效。
export const MASK_ALGORITHM_VERSION = "glyph-mask-v1";

export const MaskBlockCoverageSchema = z.object({
  blockId: z.string().min(1),
  maskedPixels: z.number().int().nonnegative(),
  bboxAreaPx: z.number().int().nonnegative(),
  // 掩盖像素占该块 bbox 面积的比例；受控膨胀可能略超 1。
  coverageRatio: z.number().min(0),
});

// mask 阶段完整性记录：绑定源图/复核文件哈希、算法版本、参数与全部输出哈希，
// 供 clean 阶段校验 mask 来源与是否被外部改动。
export const MaskRecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  algorithmVersion: z.string().min(1),
  image: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  sourceImageSha256: z.string().regex(SHA256),
  // 被消费的 text-blocks.json 内容哈希，与 validate-review 门禁锚点一致。
  reviewDocumentSha256: z.string().regex(SHA256),
  reviewValidationSha256: z.string().regex(SHA256),
  maskedBlockIds: z.array(z.string().min(1)),
  blocks: z.array(MaskBlockCoverageSchema),
  totals: z.object({
    maskedPixels: z.number().int().nonnegative(),
    maskedBlockCount: z.number().int().nonnegative(),
  }),
  outputs: z.object({
    maskSha256: z.string().regex(SHA256),
    previewSha256: z.string().regex(SHA256),
    overlaySha256: z.string().regex(SHA256),
  }),
});

export type MaskBlockCoverage = z.infer<typeof MaskBlockCoverageSchema>;
export type MaskRecord = z.infer<typeof MaskRecordSchema>;
