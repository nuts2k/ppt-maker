import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";
import {
  BoundingBoxPxSchema,
  type OcrProbeResponse,
  PointPxSchema,
  QuadPxSchema,
  TextBlockSourceSchema,
} from "./contracts.js";
import type { VisionAnalysisResult } from "./vision-analysis-contracts.js";

// 候选合并算法版本，纳入 review 阶段输入指纹；算法演进时使 review 及下游失效。
export const TEXT_MERGE_ALGORITHM_VERSION = "text-merge-v1";

// 判定两个候选属于同一区域的最小 bbox 交并比。
export const MERGE_IOU_THRESHOLD = 0.5;

export const TextBlockStyleSchema = z.object({
  fontSizePx: z.number().finite().positive().nullable(),
  fontWeight: z.enum(["regular", "medium", "semibold", "bold"]).nullable(),
  colorHex: z
    .string()
    .regex(/^#[a-f0-9]{6}$/iu)
    .nullable(),
  horizontalAlign: z.enum(["left", "center", "right"]).nullable(),
  verticalAlign: z.enum(["top", "middle", "bottom"]).nullable(),
  lineHeight: z.number().finite().positive().nullable(),
});

// 自动 mask 生成参数：人工只能在结构化数据层调整，mask 阶段据此派生像素 mask。
export const AutoMaskParamsSchema = z.object({
  foregroundColors: z.array(z.string().regex(/^#[a-f0-9]{6}$/iu)),
  colorTolerance: z.number().finite().nonnegative(),
  edgeThreshold: z.number().finite().nonnegative(),
  minComponentAreaPx: z.number().finite().nonnegative(),
  dilationRadiusPx: z.number().finite().nonnegative(),
  excludePolygons: z.array(z.array(PointPxSchema)),
});

export const RiskAcceptanceSchema = z.object({
  acceptedBy: z.string().min(1),
  acceptedAt: z.string().datetime(),
  note: z.string(),
});

// 复核文字块：review/text-blocks.json 的唯一主要人工编辑单元。
export const TextReviewBlockSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  text: z.string(),
  lines: z.array(z.string()),
  bboxPx: BoundingBoxPxSchema,
  quadPx: QuadPxSchema.nullable(),
  rotationDeg: z.number().finite(),
  zIndex: z.number().int().nonnegative(),
  classification: z.enum([
    "layout_text",
    "object_integrated_symbol",
    "uncertain",
  ]),
  sources: z.array(TextBlockSourceSchema),
  includeInMask: z.boolean(),
  reviewStatus: z.enum(["unreviewed", "reviewed", "accepted_with_risk"]),
  riskAcceptance: RiskAcceptanceSchema.nullable(),
  style: TextBlockStyleSchema,
  maskParams: AutoMaskParamsSchema,
  updatedAt: z.string().datetime().nullable(),
});

// 参考文案中未能匹配到任何区域的候选行，作为疑似漏字提示留待人工判断。
export const UnmatchedReferenceCandidateSchema = z.object({
  text: z.string().min(1),
});

export const TextReviewDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  slideId: z.string().min(1),
  image: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  generatedAt: z.string().datetime(),
  // 首次候选生成时间，跨重跑保留，用于人工复核耗时统计。
  reviewStartedAt: z.string().datetime().nullable(),
  blocks: z.array(TextReviewBlockSchema),
  unmatchedReferenceCandidates: z.array(UnmatchedReferenceCandidateSchema),
});

export type TextBlockStyle = z.infer<typeof TextBlockStyleSchema>;
export type AutoMaskParams = z.infer<typeof AutoMaskParamsSchema>;
export type RiskAcceptance = z.infer<typeof RiskAcceptanceSchema>;
export type TextReviewBlock = z.infer<typeof TextReviewBlockSchema>;
export type TextReviewDocument = z.infer<typeof TextReviewDocumentSchema>;

export interface MergeTextBlockInputs {
  readonly slideId: string;
  readonly image: { readonly width: number; readonly height: number };
  readonly ocr: OcrProbeResponse;
  readonly analysis: VisionAnalysisResult | null;
  readonly referenceText: string | null;
  readonly existing: TextReviewDocument | null;
  readonly now: string;
}

interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type Classification = TextReviewBlock["classification"];
type CandidateSource = z.infer<typeof TextBlockSourceSchema>;

interface GeoCandidate {
  readonly source: CandidateSource;
  readonly bboxPx: BoundingBox;
  readonly quadPx: TextReviewBlock["quadPx"];
  readonly rotationDeg: number | null;
  readonly classification: Classification | null;
  readonly style: TextBlockStyle | null;
  readonly foregroundColors: readonly string[];
}

function bboxIou(a: BoundingBox, b: BoundingBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (intersection === 0) {
    return 0;
  }
  const union = a.width * a.height + b.width * b.height - intersection;
  return union === 0 ? 0 : intersection / union;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : [text];
}

function normalizeForMatch(text: string): string {
  return text.trim().replace(/\s+/gu, " ").toLowerCase();
}

function defaultMaskParams(
  foregroundColors: readonly string[],
): AutoMaskParams {
  return {
    foregroundColors: [...foregroundColors],
    colorTolerance: 32,
    edgeThreshold: 0.5,
    minComponentAreaPx: 4,
    dilationRadiusPx: 1,
    excludePolygons: [],
  };
}

const EMPTY_STYLE: TextBlockStyle = {
  fontSizePx: null,
  fontWeight: null,
  colorHex: null,
  horizontalAlign: null,
  verticalAlign: null,
  lineHeight: null,
};

function ocrCandidates(ocr: OcrProbeResponse): GeoCandidate[] {
  return ocr.blocks.map((block) => ({
    source: {
      kind: "offline_ocr" as const,
      provider: ocr.provider,
      text: block.text,
      confidence: block.confidence,
    },
    bboxPx: block.bboxPx,
    quadPx: null,
    rotationDeg: block.rotationDeg,
    classification: null,
    style: null,
    foregroundColors: [],
  }));
}

function visionCandidates(analysis: VisionAnalysisResult): GeoCandidate[] {
  return analysis.candidates.map((candidate) => ({
    source: {
      kind: "cloud_vision" as const,
      provider: "openai-vision",
      text: candidate.text,
      confidence: null,
    },
    bboxPx: candidate.bboxPx,
    quadPx: candidate.quadPx,
    rotationDeg: candidate.rotationDeg,
    classification: candidate.classification,
    style: {
      fontSizePx: candidate.style.fontSizePx,
      fontWeight: candidate.style.fontWeight,
      colorHex: candidate.style.colorHex,
      horizontalAlign: candidate.style.horizontalAlign,
      verticalAlign: candidate.style.verticalAlign,
      lineHeight: null,
    },
    foregroundColors: candidate.foregroundColors,
  }));
}

interface CandidateCluster {
  representative: GeoCandidate;
  members: GeoCandidate[];
}

// 按 bbox 交并比贪心聚类，把多来源的同区域候选归并到一个簇。
function clusterCandidates(
  candidates: readonly GeoCandidate[],
): CandidateCluster[] {
  const clusters: CandidateCluster[] = [];
  for (const candidate of candidates) {
    const target = clusters.find(
      (cluster) =>
        bboxIou(cluster.representative.bboxPx, candidate.bboxPx) >=
        MERGE_IOU_THRESHOLD,
    );
    if (target === undefined) {
      clusters.push({ representative: candidate, members: [candidate] });
    } else {
      target.members.push(candidate);
    }
  }
  return clusters;
}

function readingOrder(a: BoundingBox, b: BoundingBox): number {
  if (Math.abs(a.y - b.y) > Math.min(a.height, b.height) / 2) {
    return a.y - b.y;
  }
  return a.x - b.x;
}

function buildFreshBlock(
  cluster: CandidateCluster,
  id: string,
  zIndex: number,
): TextReviewBlock {
  const vision = cluster.members.find(
    (candidate) => candidate.source.kind === "cloud_vision",
  );
  const seed = vision ?? cluster.representative;
  const classification: Classification = vision?.classification ?? "uncertain";
  const foregroundColors = vision?.foregroundColors ?? [];
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    text: seed.source.text,
    lines: splitLines(seed.source.text),
    bboxPx: seed.bboxPx,
    quadPx: seed.quadPx,
    rotationDeg: seed.rotationDeg ?? 0,
    zIndex,
    classification,
    sources: cluster.members.map((candidate) => candidate.source),
    includeInMask: false,
    reviewStatus: "unreviewed",
    riskAcceptance: null,
    style: vision?.style ?? EMPTY_STYLE,
    maskParams: defaultMaskParams(foregroundColors),
    updatedAt: null,
  };
}

function isHumanTouched(block: TextReviewBlock): boolean {
  return (
    block.reviewStatus !== "unreviewed" ||
    block.riskAcceptance !== null ||
    block.updatedAt !== null ||
    block.sources.some((source) => source.kind === "manual")
  );
}

// 保留人工确认块的所有编辑字段，仅刷新其中的候选来源（保留 manual 来源）。
function refreshHumanSources(
  human: TextReviewBlock,
  fresh: TextReviewBlock,
): CandidateSource[] {
  const manual = human.sources.filter((source) => source.kind === "manual");
  return [...fresh.sources, ...manual];
}

function attachReferenceCandidates(
  blocks: readonly TextReviewBlock[],
  referenceText: string | null,
): { blocks: TextReviewBlock[]; unmatched: { text: string }[] } {
  const mutable = blocks.map((block) => ({
    block,
    sources: [...block.sources],
  }));
  const unmatched: { text: string }[] = [];
  if (referenceText !== null) {
    const seen = new Set<string>();
    for (const rawLine of referenceText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0) {
        continue;
      }
      const normalized = normalizeForMatch(line);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      const match = mutable.find(({ block }) => {
        const blockText = normalizeForMatch(block.text);
        if (blockText.length === 0) {
          return false;
        }
        return (
          blockText === normalized ||
          blockText.includes(normalized) ||
          normalized.includes(blockText)
        );
      });
      if (match === undefined) {
        unmatched.push({ text: line });
        continue;
      }
      const alreadyPresent = match.sources.some(
        (source) =>
          source.kind === "reference_text" &&
          normalizeForMatch(source.text) === normalized,
      );
      if (!alreadyPresent) {
        match.sources.push({
          kind: "reference_text",
          provider: "reference",
          text: line,
          confidence: null,
        });
      }
    }
  }
  return {
    blocks: mutable.map(({ block, sources }) => ({ ...block, sources })),
    unmatched,
  };
}

export function mergeTextBlockCandidates(
  input: MergeTextBlockInputs,
): TextReviewDocument {
  const candidates = [
    ...(input.analysis === null ? [] : visionCandidates(input.analysis)),
    ...ocrCandidates(input.ocr),
  ];
  const clusters = clusterCandidates(candidates);
  const orderedClusters = [...clusters].sort((a, b) =>
    readingOrder(a.representative.bboxPx, b.representative.bboxPx),
  );

  const humanBlocks = (input.existing?.blocks ?? []).filter(isHumanTouched);
  const reserved = new Set(humanBlocks.map((block) => block.id));
  let counter = 0;
  const nextFreshId = (): string => {
    let id = "";
    do {
      counter += 1;
      id = `block-${String(counter).padStart(3, "0")}`;
    } while (reserved.has(id));
    reserved.add(id);
    return id;
  };

  const freshBlocks = orderedClusters.map((cluster, index) =>
    buildFreshBlock(cluster, nextFreshId(), index),
  );

  const consumed = new Set<number>();
  const adoptedHumanBlocks = humanBlocks.map((human) => {
    let bestIndex = -1;
    let best: TextReviewBlock | undefined;
    let bestIou = MERGE_IOU_THRESHOLD;
    freshBlocks.forEach((fresh, index) => {
      if (consumed.has(index)) {
        return;
      }
      const iou = bboxIou(human.bboxPx, fresh.bboxPx);
      if (iou >= bestIou) {
        bestIou = iou;
        bestIndex = index;
        best = fresh;
      }
    });
    if (best === undefined) {
      return human;
    }
    consumed.add(bestIndex);
    return { ...human, sources: refreshHumanSources(human, best) };
  });

  const newFreshBlocks = freshBlocks.filter((_, index) => !consumed.has(index));
  const combined = [...adoptedHumanBlocks, ...newFreshBlocks];

  const withReference = attachReferenceCandidates(
    combined,
    input.referenceText,
  );
  const sortedBlocks = [...withReference.blocks].sort(
    (a, b) => a.zIndex - b.zIndex || readingOrder(a.bboxPx, b.bboxPx),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    slideId: input.slideId,
    image: input.image,
    generatedAt: input.now,
    reviewStartedAt: input.existing?.reviewStartedAt ?? input.now,
    blocks: sortedBlocks,
    unmatchedReferenceCandidates: withReference.unmatched,
  };
}

// review 校验规则版本，写入校验报告，规则演进时可与旧报告区分。
export const REVIEW_VALIDATION_RULES_VERSION = "review-validation-v1";

// 旋转角度的合法性上界（度），超出视为数据错误而非有效版式。
export const ROTATION_LIMIT_DEG = 360;

export const ReviewViolationSchema = z.object({
  blockId: z.string().min(1).nullable(),
  field: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["error", "warning"]),
});

export const TextReviewValidationReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  slideId: z.string().min(1),
  rulesVersion: z.string().min(1),
  status: z.enum(["passed", "failed"]),
  checkedAt: z.string().datetime(),
  // 被校验的 text-blocks.json 内容哈希，下游 mask/pptx 阶段据此锚定门禁。
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  violations: z.array(ReviewViolationSchema),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
});

export type ReviewViolation = z.infer<typeof ReviewViolationSchema>;
export type TextReviewValidationReport = z.infer<
  typeof TextReviewValidationReportSchema
>;

export interface ReviewValidationContext {
  readonly image: { readonly width: number; readonly height: number };
}

function quadArea(quad: NonNullable<TextReviewBlock["quadPx"]>): number {
  const [a, b, c, d] = quad;
  const sum =
    a.x * b.y -
    b.x * a.y +
    (b.x * c.y - c.x * b.y) +
    (c.x * d.y - d.x * c.y) +
    (d.x * a.y - a.x * d.y);
  return Math.abs(sum) / 2;
}

// 逐条内容校验，覆盖分类/mask 参与、坐标、四边形、旋转、样式与风险接受规则。
// Schema 级别的类型/枚举/结构约束由 TextReviewDocumentSchema.parse 事先保证。
export function validateTextReviewDocument(
  document: TextReviewDocument,
  context: ReviewValidationContext,
): ReviewViolation[] {
  const violations: ReviewViolation[] = [];
  const { width, height } = context.image;

  if (document.image.width !== width || document.image.height !== height) {
    violations.push({
      blockId: null,
      field: "image",
      code: "IMAGE_DIMENSION_MISMATCH",
      message: `文档图片尺寸 ${document.image.width}×${document.image.height} 与源图 ${width}×${height} 不一致`,
      severity: "error",
    });
  }

  const seenIds = new Set<string>();
  for (const block of document.blocks) {
    if (seenIds.has(block.id)) {
      violations.push({
        blockId: block.id,
        field: "id",
        code: "DUPLICATE_BLOCK_ID",
        message: `文字块 id 重复：${block.id}`,
        severity: "error",
      });
    }
    seenIds.add(block.id);

    if (block.text.trim().length === 0) {
      violations.push({
        blockId: block.id,
        field: "text",
        code: "TEXT_EMPTY",
        message: "文字块内容不能为空",
        severity: "error",
      });
    } else if (block.lines.length === 0) {
      violations.push({
        blockId: block.id,
        field: "lines",
        code: "LINES_EMPTY",
        message: "非空文字块必须至少包含一行换行内容",
        severity: "error",
      });
    }

    // 只有确认的版式目标文字可进入 mask；对象内符号与不确定项一律排除。
    if (block.includeInMask && block.classification !== "layout_text") {
      violations.push({
        blockId: block.id,
        field: "includeInMask",
        code: "MASK_REQUIRES_LAYOUT_TEXT",
        message: `分类为 ${block.classification} 的文字块不得参与 mask`,
        severity: "error",
      });
    }

    const box = block.bboxPx;
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > width ||
      box.y + box.height > height
    ) {
      violations.push({
        blockId: block.id,
        field: "bboxPx",
        code: "BBOX_OUT_OF_BOUNDS",
        message: "文字框边界必须完全位于源图范围内",
        severity: "error",
      });
    }

    if (block.quadPx !== null) {
      const outOfBounds = block.quadPx.some(
        (point) =>
          point.x < 0 || point.y < 0 || point.x > width || point.y > height,
      );
      if (outOfBounds) {
        violations.push({
          blockId: block.id,
          field: "quadPx",
          code: "QUAD_OUT_OF_BOUNDS",
          message: "四边形顶点必须位于源图范围内",
          severity: "error",
        });
      }
      if (quadArea(block.quadPx) < 1e-6) {
        violations.push({
          blockId: block.id,
          field: "quadPx",
          code: "QUAD_DEGENERATE",
          message: "四边形退化（面积为零），无法表达旋转区域",
          severity: "error",
        });
      }
    }

    if (Math.abs(block.rotationDeg) > ROTATION_LIMIT_DEG) {
      violations.push({
        blockId: block.id,
        field: "rotationDeg",
        code: "ROTATION_OUT_OF_RANGE",
        message: `旋转角度必须在 ±${ROTATION_LIMIT_DEG} 度内`,
        severity: "error",
      });
    }

    if (block.style.fontSizePx !== null && block.style.fontSizePx > height) {
      violations.push({
        blockId: block.id,
        field: "style.fontSizePx",
        code: "FONT_SIZE_OUT_OF_RANGE",
        message: "字号不得超过源图高度",
        severity: "error",
      });
    }

    if (
      block.reviewStatus === "accepted_with_risk" &&
      block.riskAcceptance === null
    ) {
      violations.push({
        blockId: block.id,
        field: "riskAcceptance",
        code: "RISK_ACCEPTANCE_MISSING",
        message: "标记为 accepted_with_risk 的文字块必须填写风险接受记录",
        severity: "error",
      });
    }
    if (
      block.riskAcceptance !== null &&
      block.reviewStatus !== "accepted_with_risk"
    ) {
      violations.push({
        blockId: block.id,
        field: "reviewStatus",
        code: "RISK_ACCEPTANCE_STATUS_MISMATCH",
        message: "存在风险接受记录时复核状态必须为 accepted_with_risk",
        severity: "error",
      });
    }

    // 版式目标文字在导出前必须复核；此处仅提示，硬门禁由 pptx 阶段执行。
    if (
      block.classification === "layout_text" &&
      block.reviewStatus === "unreviewed"
    ) {
      violations.push({
        blockId: block.id,
        field: "reviewStatus",
        code: "TARGET_TEXT_UNREVIEWED",
        message: "版式目标文字尚未复核，导出前必须复核或显式接受风险",
        severity: "warning",
      });
    }
  }

  return violations;
}
