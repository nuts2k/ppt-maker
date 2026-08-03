export type FoundationErrorCode =
  | "INVALID_INPUT"
  | "WORKSPACE_EXISTS"
  | "INVALID_DIMENSIONS"
  | "INVALID_ASPECT_RATIO"
  | "INVALID_BOUNDING_BOX"
  | "INVALID_PROVIDER_RESPONSE"
  | "INVALID_WORKSPACE"
  | "WORKSPACE_ALREADY_EXISTS"
  | "INVALID_STAGE_STATE"
  | "ASSET_INTEGRITY_MISMATCH"
  | "PATH_OUTSIDE_WORKSPACE"
  | "UPLOAD_CONFIRMATION_REQUIRED"
  | "API_CONFIRMATION_REQUIRED"
  | "MISSING_DEPENDENCY"
  | "UNSUPPORTED_ENVIRONMENT"
  // M6 子任务①：规格编辑与变更日志（design §9）
  | "SPEC_HISTORY_RECORD_NOT_FOUND"
  | "SPEC_SELECTION_EMPTY"
  | "SPEC_PAGE_NOT_FOUND";

export class FoundationError extends Error {
  readonly code: FoundationErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: FoundationErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "FoundationError";
    this.code = code;
    this.details = details;
  }
}
