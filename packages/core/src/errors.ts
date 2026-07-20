export type FoundationErrorCode =
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
  | "MISSING_DEPENDENCY"
  | "UNSUPPORTED_ENVIRONMENT";

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
