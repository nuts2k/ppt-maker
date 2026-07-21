import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";

export const TextAssistBlockSchema = z.object({
  blockId: z.string().min(1),
  correctedText: z.string().min(1),
  classification: z.enum([
    "layout_text",
    "object_integrated_symbol",
    "uncertain",
  ]),
  risks: z.array(
    z.enum(["low_confidence", "classification_uncertain", "text_uncertain"]),
  ),
  rationale: z.string(),
});

export const TextAssistResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  blocks: z.array(TextAssistBlockSchema),
});

export type TextAssistBlock = z.infer<typeof TextAssistBlockSchema>;
export type TextAssistResult = z.infer<typeof TextAssistResultSchema>;
