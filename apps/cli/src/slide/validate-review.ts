import { readFile } from "node:fs/promises";
import {
  FoundationError,
  REVIEW_VALIDATION_RULES_VERSION,
  type ReviewViolation,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
  TextReviewDocumentSchema,
  type TextReviewValidationReport,
  TextReviewValidationReportSchema,
  validateTextReviewDocument,
  type WorkspaceAsset,
} from "@ppt-maker/core";
import {
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256File,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "./workspace.js";

const REVIEW_OUTPUT_PATH = "stages/review/text-blocks.json";
const VALIDATION_OUTPUT_PATH = "stages/review/validation.json";
const VALIDATION_ASSET_ID = "asset-review-validation";

export interface RunSlideValidateReviewOptions {
  readonly workspacePath: string;
}

export interface RunSlideValidateReviewResult {
  readonly reportPath: string;
  readonly report: TextReviewValidationReport;
}

function findSourceAsset(manifest: SlideWorkspaceManifest): WorkspaceAsset {
  const asset = manifest.assets.find(
    (candidate) => candidate.id === manifest.sourceImageAssetId,
  );
  if (asset === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "manifest 未引用有效源图资产",
      { sourceImageAssetId: manifest.sourceImageAssetId },
    );
  }
  return asset;
}

export async function runSlideValidateReview(
  options: RunSlideValidateReviewOptions,
): Promise<RunSlideValidateReviewResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const reviewState = workspace.manifest.stages.find(
    (state) => state.stage === "review",
  );
  if (
    reviewState?.status !== "completed" ||
    reviewState.lastSuccessfulAttemptId === null
  ) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 validate-review 前必须先完成 review 生成 text-blocks.json",
      { reviewStatus: reviewState?.status ?? "missing" },
    );
  }

  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH);
  let content: string;
  try {
    content = await readFile(reviewPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new FoundationError(
        "INVALID_STAGE_STATE",
        `未找到复核文件：${REVIEW_OUTPUT_PATH}`,
      );
    }
    throw error;
  }
  const documentSha256 = await sha256File(reviewPath);

  const source = findSourceAsset(workspace.manifest);
  if (source.image === null) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "源图资产缺少尺寸元数据，无法校验坐标",
    );
  }

  const violations: ReviewViolation[] = [];
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch (error) {
    violations.push({
      blockId: null,
      field: "document",
      code: "JSON_PARSE_ERROR",
      message: error instanceof Error ? error.message : String(error),
      severity: "error",
    });
  }

  if (violations.length === 0) {
    const parsed = TextReviewDocumentSchema.safeParse(parsedJson);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        violations.push({
          blockId: null,
          field: issue.path.length === 0 ? "document" : issue.path.join("."),
          code: "SCHEMA_INVALID",
          message: issue.message,
          severity: "error",
        });
      }
    } else {
      if (parsed.data.slideId !== workspace.manifest.slideId) {
        violations.push({
          blockId: null,
          field: "slideId",
          code: "SLIDE_ID_MISMATCH",
          message: "text-blocks.json 的 slideId 与工作区不一致",
          severity: "error",
        });
      }
      violations.push(
        ...validateTextReviewDocument(parsed.data, {
          image: { width: source.image.width, height: source.image.height },
        }),
      );
    }
  }

  const errors = violations.filter(
    (violation) => violation.severity === "error",
  ).length;
  const warnings = violations.length - errors;
  const report: TextReviewValidationReport =
    TextReviewValidationReportSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      slideId: workspace.manifest.slideId,
      rulesVersion: REVIEW_VALIDATION_RULES_VERSION,
      status: errors === 0 ? "passed" : "failed",
      checkedAt: new Date().toISOString(),
      documentSha256,
      violations,
      summary: { errors, warnings },
    });

  const reportPath = resolveWorkspacePath(
    workspace.path,
    VALIDATION_OUTPUT_PATH,
  );
  await writeJsonAtomic(reportPath, report);
  const asset = await createWorkspaceAsset(reportPath, {
    schemaVersion: SCHEMA_VERSION,
    id: VALIDATION_ASSET_ID,
    path: VALIDATION_OUTPUT_PATH,
    role: "review_validation",
    createdAt: report.checkedAt,
    producedBy: "review",
    attemptId: reviewState.lastSuccessfulAttemptId,
    image: null,
  });
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    updatedAt: report.checkedAt,
    assets: [
      ...workspace.manifest.assets.filter(
        (candidate) => candidate.id !== VALIDATION_ASSET_ID,
      ),
      asset,
    ],
  });

  return { reportPath, report };
}
