import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";
import {
  SHA256_PATTERN,
  WorkspaceRelativePathSchema,
} from "./workspace-contracts.js";

export const DeckSlideEntrySchema = z.object({
  slideId: z.string().min(1),
  workspacePath: WorkspaceRelativePathSchema,
  sourceImageName: z.string().min(1),
  addedAt: z.string().datetime(),
  removedAt: z.string().datetime().nullable(),
});

export const DeckExportRecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  exportedAt: z.string().datetime(),
  outputPath: WorkspaceRelativePathSchema,
  outputSha256: z.string().regex(SHA256_PATTERN),
  totalSlides: z.number().int().nonnegative(),
  nativeSlides: z.number().int().nonnegative(),
  placeholderSlides: z.number().int().nonnegative(),
  strict: z.boolean(),
});

export const DeckManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  deckVersion: z.literal(1),
  deckId: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  aspectRatio: z.literal("16:9"),
  fontFace: z.literal("Microsoft YaHei"),
  cloudCalls: z.literal("explicit_only"),
  slides: z.array(DeckSlideEntrySchema),
  exports: z.array(DeckExportRecordSchema),
});

export type DeckSlideEntry = z.infer<typeof DeckSlideEntrySchema>;
export type DeckExportRecord = z.infer<typeof DeckExportRecordSchema>;
export type DeckManifest = z.infer<typeof DeckManifestSchema>;
