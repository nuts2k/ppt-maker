import { z } from "zod";
import { CleanPlateChecksSchema } from "./clean-contracts.js";
import { SCHEMA_VERSION } from "./constants.js";

// 分阶段验证报告（design §8）：分别报告内容/分类/mask/clean plate/PPTX 与人工耗时，
// 自动检查与人工接受分开呈现；任何未通过/未完成不得汇总为成功。
export const SlideReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  slideId: z.string().min(1),
  generatedAt: z.string().datetime(),
  // complete 仅当全部阶段完成、自动检查通过且两道人工门已接受且未 stale。
  overallStatus: z.enum(["complete", "incomplete"]),
  stages: z.array(
    z.object({
      stage: z.string().min(1),
      status: z.string().min(1),
    }),
  ),
  discovery: z.object({
    ocrBlockCount: z.number().int().nonnegative(),
    reviewBlockCount: z.number().int().nonnegative(),
    reviewedLayoutTextCount: z.number().int().nonnegative(),
    unreviewedLayoutTextCount: z.number().int().nonnegative(),
  }),
  classification: z.object({
    layoutText: z.number().int().nonnegative(),
    objectIntegratedSymbol: z.number().int().nonnegative(),
    uncertain: z.number().int().nonnegative(),
  }),
  mask: z
    .object({
      maskedBlockCount: z.number().int().nonnegative(),
      maskedPixels: z.number().int().nonnegative(),
    })
    .nullable(),
  // 自动检查区（不代表人工验收）。
  autoChecks: z.object({
    cleanPlate: CleanPlateChecksSchema.nullable(),
    pptx: z
      .object({
        status: z.enum(["passed", "failed"]),
        checks: z.array(
          z.object({
            id: z.string().min(1),
            status: z.enum(["passed", "failed"]),
            message: z.string().min(1),
          }),
        ),
      })
      .nullable(),
  }),
  // 人工接受区（与自动检查分开）。
  manualAcceptance: z.object({
    cleanPlate: z
      .object({
        acceptedBy: z.string().min(1),
        acceptedAt: z.string().datetime(),
        stale: z.boolean(),
      })
      .nullable(),
    pptx: z
      .object({
        acceptedBy: z.string().min(1),
        acceptedAt: z.string().datetime(),
        stale: z.boolean(),
      })
      .nullable(),
  }),
  providerCalls: z.array(
    z.object({
      stage: z.string().min(1),
      model: z.string().min(1),
      requestId: z.string().min(1).nullable(),
      durationMs: z.number().int().nonnegative().nullable(),
      usage: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  manualReview: z.object({
    reviewStartedAt: z.string().datetime().nullable(),
    cleanAcceptedAt: z.string().datetime().nullable(),
    pptxAcceptedAt: z.string().datetime().nullable(),
    // 人工复核耗时口径：首次候选（reviewStartedAt）到最终 PPTX 接受（design R4）。
    reviewToPptxAcceptMs: z.number().int().nonnegative().nullable(),
  }),
});

export type SlideReport = z.infer<typeof SlideReportSchema>;
