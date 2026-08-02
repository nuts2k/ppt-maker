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
  /**
   * 上一份校验报告用的规则版本，仅当它与当前版本**不同**时才有值。
   *
   * 用途只有一个：本次失败可能是规则升级导致的，失败提示要说清这件事。
   * 2026-07-25 之前建的 deck 会在 `deck run` 时撞上 `review-validation-v1 → v2`
   * 新增的 `LAYOUT_TEXT_MUST_BE_MASKED` 而停住，失败信息本身很响亮（指名 blockId
   * 与后果），但读起来像是「你把文件改坏了」。
   *
   * **不落盘**：它是这一次运行的上下文，不是报告的属性；写进 schema 会让每份报告
   * 多带一个只有一次有意义的字段，且旧报告读不回来。
   */
  readonly previousRulesVersion: string | null;
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

/** 读回当前那份校验报告；文件缺失或结构不合法一律当作「没有可复用的」 */
async function readValidationReport(
  path: string,
): Promise<TextReviewValidationReport | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  try {
    return TextReviewValidationReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
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

  /*
   * 复用判据：同一份复核稿 + 同一版规则 = 同一份结论，重算只会换掉 `checkedAt`。
   *
   * validate-review 是**瞬态阶段**（不在 `SlideStage` 里、不写 `stages`），所以它没有
   * `isStageReusable` 可用；但这不是给它造一个假持久状态的理由——判据本来就摆在产物里：
   * 报告自己记着被校验文件的 `documentSha256` 与 `rulesVersion`。
   *
   * 还要求资产绑在**当前那次 review attempt** 上：校验用到源图尺寸判 bbox 越界，
   * 换源（尤其 `--keep-review` 保住复核稿那条路）之后同一份文档在新尺寸下结论可能不同。
   * review 重跑必然换 attempt id，这一条就把「源图变了」一并挡住了。
   */
  const currentAsset = workspace.manifest.assets.find(
    (candidate) =>
      candidate.id === VALIDATION_ASSET_ID &&
      candidate.path === VALIDATION_OUTPUT_PATH &&
      candidate.attemptId === reviewState.lastSuccessfulAttemptId,
  );
  const existing =
    currentAsset === undefined
      ? null
      : await readValidationReport(
          resolveWorkspacePath(workspace.path, VALIDATION_OUTPUT_PATH),
        );
  const previousRulesVersion =
    existing !== null &&
    existing.rulesVersion !== REVIEW_VALIDATION_RULES_VERSION
      ? existing.rulesVersion
      : null;
  if (
    existing !== null &&
    existing.documentSha256 === documentSha256 &&
    previousRulesVersion === null
  ) {
    return {
      reportPath: resolveWorkspacePath(workspace.path, VALIDATION_OUTPUT_PATH),
      report: existing,
      previousRulesVersion: null,
    };
  }

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

  return { reportPath, report, previousRulesVersion };
}
