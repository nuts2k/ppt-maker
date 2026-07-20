import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const SlideStageSchema = z.enum([
  "init",
  "ocr",
  "analyze",
  "review",
  "mask",
  "clean",
  "accept-clean",
  "pptx",
  "accept-pptx",
  "report",
]);

export const WorkspaceStageStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "interrupted",
  "stale",
]);

export const WorkspaceRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/"), "路径必须是工作区相对路径")
  .refine((value) => !value.includes("\\"), "路径必须使用正斜杠")
  .refine((value) => !/^[a-z]:/iu.test(value), "路径不得包含盘符")
  .refine((value) => !value.split("/").includes(".."), "路径不得离开工作区");

export const WorkspaceAssetSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  path: WorkspaceRelativePathSchema,
  role: z.enum([
    "source_image",
    "reference_text",
    "ocr_result",
    "analysis_result",
    "text_review",
    "review_validation",
    "mask",
    "mask_preview",
    "mask_overlay",
    "mask_record",
    "clean_plate",
    "clean_record",
    "clean_check",
    "clean_acceptance",
    "pptx",
    "report",
    "provider_record",
    "provider_response",
  ]),
  sha256: z.string().regex(SHA256_PATTERN),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  producedBy: SlideStageSchema,
  attemptId: z.string().min(1),
  image: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      format: z.enum(["png", "jpg", "jpeg"]),
    })
    .nullable(),
});

export const WorkspaceStageStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  stage: SlideStageSchema,
  status: WorkspaceStageStatusSchema,
  latestAttemptId: z.string().min(1).nullable(),
  lastSuccessfulAttemptId: z.string().min(1).nullable(),
  completedInputFingerprint: z.string().regex(SHA256_PATTERN).nullable(),
  invalidatedAt: z.string().datetime().nullable(),
  invalidationReason: z.string().min(1).nullable(),
});

export const WorkspaceStageAttemptSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  stage: SlideStageSchema,
  number: z.number().int().positive(),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  inputFingerprint: z.string().regex(SHA256_PATTERN),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  provider: z.string().min(1).nullable(),
  providerVersion: z.string().min(1).nullable(),
  assetIds: z.array(z.string().min(1)),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      details: z.record(z.string(), z.unknown()).optional(),
    })
    .nullable(),
});

export const ProviderCallRecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  stage: z.enum(["analyze", "clean"]),
  provider: z.literal("openai"),
  endpoint: z.string().min(1),
  model: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
  promptVersion: z.string().min(1),
  sentAssets: z.array(
    z.object({
      path: WorkspaceRelativePathSchema,
      sha256: z.string().regex(SHA256_PATTERN),
    }),
  ),
  requestId: z.string().min(1).nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  usage: z.record(z.string(), z.unknown()).nullable(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .nullable(),
  rawResponsePath: WorkspaceRelativePathSchema.nullable(),
  rawResponseSha256: z.string().regex(SHA256_PATTERN).nullable(),
  parsedResponsePath: WorkspaceRelativePathSchema.nullable(),
  parsedResponseSha256: z.string().regex(SHA256_PATTERN).nullable(),
});

export const ArtifactAcceptanceSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  stage: z.enum(["accept-clean", "accept-pptx"]),
  artifactAssetId: z.string().min(1),
  artifactSha256: z.string().regex(SHA256_PATTERN),
  upstreamFingerprint: z.string().regex(SHA256_PATTERN),
  acceptedAt: z.string().datetime(),
  acceptedBy: z.string().min(1),
  note: z.string(),
  checklist: z.record(z.string(), z.boolean()),
});

export const StageValidationReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  stage: SlideStageSchema,
  status: z.enum(["passed", "failed", "not_run"]),
  checks: z.array(
    z.object({
      id: z.string().min(1),
      status: z.enum(["passed", "failed", "warning", "not_run"]),
      message: z.string().min(1),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

export const SlideValidationReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  slideId: z.string().min(1),
  generatedAt: z.string().datetime(),
  status: z.enum(["passed", "failed", "incomplete"]),
  stages: z.array(StageValidationReportSchema),
  cleanAcceptanceId: z.string().min(1).nullable(),
  pptxAcceptanceId: z.string().min(1).nullable(),
  reviewDurationMs: z.number().int().nonnegative().nullable(),
});

export const SlideWorkspaceConfigSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  slideId: z.string().min(1),
  aspectRatio: z.literal("16:9"),
  fontFace: z.literal("Microsoft YaHei"),
  cloudCalls: z.literal("explicit_only"),
  sourceImagePath: WorkspaceRelativePathSchema,
  referenceTextPath: WorkspaceRelativePathSchema.nullable(),
});

export const SlideWorkspaceManifestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    workspaceVersion: z.literal(1),
    slideId: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    configPath: WorkspaceRelativePathSchema,
    sourceImageAssetId: z.string().min(1),
    referenceTextAssetId: z.string().min(1).nullable(),
    assets: z.array(WorkspaceAssetSchema),
    stages: z.array(WorkspaceStageStateSchema),
    attempts: z.array(WorkspaceStageAttemptSchema),
  })
  .superRefine((manifest, context) => {
    const assetIds = new Set<string>();
    for (const asset of manifest.assets) {
      if (assetIds.has(asset.id)) {
        context.addIssue({
          code: "custom",
          message: `资产 ID 重复：${asset.id}`,
          path: ["assets"],
        });
      }
      assetIds.add(asset.id);
    }

    if (!assetIds.has(manifest.sourceImageAssetId)) {
      context.addIssue({
        code: "custom",
        message: "sourceImageAssetId 未引用有效资产",
        path: ["sourceImageAssetId"],
      });
    }
    if (
      manifest.referenceTextAssetId !== null &&
      !assetIds.has(manifest.referenceTextAssetId)
    ) {
      context.addIssue({
        code: "custom",
        message: "referenceTextAssetId 未引用有效资产",
        path: ["referenceTextAssetId"],
      });
    }

    const stages = new Set<string>();
    for (const state of manifest.stages) {
      if (stages.has(state.stage)) {
        context.addIssue({
          code: "custom",
          message: `阶段状态重复：${state.stage}`,
          path: ["stages"],
        });
      }
      stages.add(state.stage);
    }
    for (const stage of SlideStageSchema.options) {
      if (!stages.has(stage)) {
        context.addIssue({
          code: "custom",
          message: `缺少阶段状态：${stage}`,
          path: ["stages"],
        });
      }
    }
  });

export type SlideStage = z.infer<typeof SlideStageSchema>;
export type WorkspaceStageStatus = z.infer<typeof WorkspaceStageStatusSchema>;
export type WorkspaceAsset = z.infer<typeof WorkspaceAssetSchema>;
export type WorkspaceStageState = z.infer<typeof WorkspaceStageStateSchema>;
export type WorkspaceStageAttempt = z.infer<typeof WorkspaceStageAttemptSchema>;
export type ProviderCallRecord = z.infer<typeof ProviderCallRecordSchema>;
export type ArtifactAcceptance = z.infer<typeof ArtifactAcceptanceSchema>;
export type StageValidationReport = z.infer<typeof StageValidationReportSchema>;
export type SlideValidationReport = z.infer<typeof SlideValidationReportSchema>;
export type SlideWorkspaceConfig = z.infer<typeof SlideWorkspaceConfigSchema>;
export type SlideWorkspaceManifest = z.infer<
  typeof SlideWorkspaceManifestSchema
>;
