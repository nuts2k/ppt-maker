import { z } from "zod";
import { CleanPlateChecksSchema } from "./clean-contracts.js";
import { SCHEMA_VERSION } from "./constants.js";
import { SourceAcceptanceModeSchema } from "./source-acceptance.js";
import { SlideSourceKindSchema } from "./source-contracts.js";

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
  /**
   * 页面来源与源图确认的**正面陈述**（父任务 A10）。
   *
   * 此前报告完全没有这一段：阶段行里只有 `accept-source=completed`，「人工接受」段
   * 只列 clean plate 与 PPTX，于是「有人确认过」与「按来源自动放行」只能靠**缺席反推**
   * ——而缺席同样可能是报告漏写。反推不是陈述。
   *
   * `acceptedBy` / `acceptedAt` **只有 `manual` 档才非空**，取自磁盘上真实存在的
   * `ArtifactAcceptance`。自动放行档一律 null：给系统署个名等于伪造人工痕迹，
   * 正是 M4 列为头号风险的「记录与事实相反」。
   */
  source: z.object({
    kind: SlideSourceKindSchema,
    acceptance: SourceAcceptanceModeSchema,
    acceptedBy: z.string().min(1).nullable(),
    acceptedAt: z.string().datetime().nullable(),
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
