import type { OcrProbeResponse } from "./contracts.js";

export interface OcrProbeRequest {
  readonly imagePath: string;
  readonly languages: readonly string[];
}

export interface OcrProvider {
  readonly id: string;
  recognize(request: OcrProbeRequest): Promise<OcrProbeResponse>;
}
