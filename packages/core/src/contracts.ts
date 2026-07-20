import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";

export const BoundingBoxPxSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const TextBlockSourceSchema = z.object({
  kind: z.enum(["offline_ocr", "cloud_vision", "reference_text", "manual"]),
  provider: z.string().min(1),
  text: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
});

export const TextBlockSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  text: z.string().min(1),
  bboxPx: BoundingBoxPxSchema,
  rotationDeg: z.number().finite(),
  confidence: z.number().min(0).max(1).nullable(),
  classification: z.enum([
    "layout_text",
    "object_integrated_symbol",
    "uncertain",
  ]),
  sources: z.array(TextBlockSourceSchema),
  includeInMask: z.boolean(),
  reviewStatus: z.enum(["unreviewed", "reviewed", "accepted_with_risk"]),
  updatedAt: z.string().datetime().nullable(),
});

export const StageStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "interrupted",
]);

export const StageRecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  stage: z.string().min(1),
  status: StageStatusSchema,
  inputHash: z.string().min(1),
  attempt: z.number().int().positive(),
  provider: z.string().min(1),
  providerVersion: z.string().min(1),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
  assetPaths: z.array(z.string().min(1)),
});

export const SlideManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  slideId: z.string().min(1),
  sourceImage: z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  stages: z.array(StageRecordSchema),
  textBlocksPath: z.string().min(1).nullable(),
});

export const OcrProbeResponseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  provider: z.literal("apple-vision"),
  image: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  blocks: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string().min(1),
      bboxPx: BoundingBoxPxSchema,
      confidence: z.number().min(0).max(1),
      rotationDeg: z.number().finite().nullable(),
    }),
  ),
});

export const DoctorCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["pass", "warn", "fail"]),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const DoctorReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  checks: z.array(DoctorCheckSchema),
  summary: z.object({
    pass: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
  }),
});

export type TextBlock = z.infer<typeof TextBlockSchema>;
export type StageRecord = z.infer<typeof StageRecordSchema>;
export type SlideManifest = z.infer<typeof SlideManifestSchema>;
export type OcrProbeResponse = z.infer<typeof OcrProbeResponseSchema>;
export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;
export type DoctorReport = z.infer<typeof DoctorReportSchema>;
