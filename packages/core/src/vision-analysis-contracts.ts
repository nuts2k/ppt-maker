import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";
import { BoundingBoxPxSchema, QuadPxSchema } from "./contracts.js";

export const VisionTextCandidateSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  bboxPx: BoundingBoxPxSchema,
  quadPx: QuadPxSchema.nullable(),
  rotationDeg: z.number().finite().nullable(),
  isArtText: z.boolean(),
  classification: z.enum([
    "layout_text",
    "object_integrated_symbol",
    "uncertain",
  ]),
  style: z.object({
    fontSizePx: z.number().finite().positive().nullable(),
    fontWeight: z.enum(["regular", "medium", "semibold", "bold"]).nullable(),
    colorHex: z
      .string()
      .regex(/^#[a-f0-9]{6}$/iu)
      .nullable(),
    horizontalAlign: z.enum(["left", "center", "right"]).nullable(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).nullable(),
    lineBreaks: z.array(z.string()),
  }),
  foregroundColors: z.array(z.string().regex(/^#[a-f0-9]{6}$/iu)),
  risks: z.array(
    z.enum([
      "low_confidence",
      "candidate_conflict",
      "possible_missing_text",
      "rotation_uncertain",
      "classification_uncertain",
      "art_text_effects",
    ]),
  ),
  rationale: z.string(),
});

export const VisionAnalysisResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  image: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  candidates: z.array(VisionTextCandidateSchema),
  missingTextHints: z.array(
    z.object({
      description: z.string().min(1),
      bboxPx: BoundingBoxPxSchema.nullable(),
    }),
  ),
  pageRisks: z.array(z.string().min(1)),
});

export type VisionTextCandidate = z.infer<typeof VisionTextCandidateSchema>;
export type VisionAnalysisResult = z.infer<typeof VisionAnalysisResultSchema>;
