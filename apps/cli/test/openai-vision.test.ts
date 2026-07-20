import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OcrProbeResponse, SCHEMA_VERSION } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  analyzeSlideVision,
  OPENAI_VISION_MODEL,
  type VisionAnalysisRequest,
} from "../src/providers/openai-vision.js";

const OCR: OcrProbeResponse = {
  schemaVersion: SCHEMA_VERSION,
  provider: "apple-vision",
  image: { width: 1600, height: 900 },
  blocks: [],
};

async function imagePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ppt-maker-openai-vision-"));
  const path = join(directory, "slide.png");
  await writeFile(path, Buffer.from("png-bytes"));
  return path;
}

describe("OpenAI vision provider", () => {
  it("固定模型、original 图片和 high reasoning，并校验结构化结果", async () => {
    const captured: VisionAnalysisRequest[] = [];
    const analysis = await analyzeSlideVision({
      imagePath: await imagePath(),
      imageMimeType: "image/png",
      ocr: OCR,
      referenceText: "候选文案",
      parseResponse: async (request) => {
        captured.push(request);
        return {
          id: "resp_test",
          model: OPENAI_VISION_MODEL,
          usage: { input_tokens: 10, output_tokens: 20 },
          outputParsed: {
            schemaVersion: SCHEMA_VERSION,
            image: { width: 1600, height: 900 },
            candidates: [],
            missingTextHints: [],
            pageRisks: [],
          },
          rawResponse: { id: "resp_test" },
        };
      },
    });

    const request = captured[0];
    expect(request).toBeDefined();
    if (request === undefined) {
      return;
    }
    expect(request.model).toBe("gpt-5.6-sol");
    expect(request.reasoning).toEqual({ effort: "high" });
    expect(request.store).toBe(false);
    expect(request.input[0]?.content[1]).toMatchObject({
      type: "input_image",
      detail: "original",
    });
    expect(analysis.requestId).toBe("resp_test");
    expect(analysis.result.image).toEqual({ width: 1600, height: 900 });
  });

  it("请求携带 Structured Outputs schema", async () => {
    let captured: VisionAnalysisRequest | undefined;
    await analyzeSlideVision({
      imagePath: await imagePath(),
      imageMimeType: "image/png",
      ocr: OCR,
      referenceText: null,
      parseResponse: async (request) => {
        captured = request;
        return {
          id: "resp_test",
          model: OPENAI_VISION_MODEL,
          usage: null,
          outputParsed: {
            schemaVersion: SCHEMA_VERSION,
            image: { width: 1600, height: 900 },
            candidates: [],
            missingTextHints: [],
            pageRisks: [],
          },
          rawResponse: {},
        };
      },
    });
    expect(JSON.stringify(captured?.text.format)).toContain(
      "slide_visual_analysis",
    );
    expect(captured?.text.format).toMatchObject({ type: "json_schema" });
  });

  it("拒绝 refusal 或空解析结果", async () => {
    await expect(
      analyzeSlideVision({
        imagePath: await imagePath(),
        imageMimeType: "image/png",
        ocr: OCR,
        referenceText: null,
        parseResponse: async () => ({
          id: "resp_refusal",
          model: OPENAI_VISION_MODEL,
          usage: null,
          outputParsed: null,
          rawResponse: { refusal: "refused" },
        }),
      }),
    ).rejects.toThrow("refusal");
  });

  it("拒绝结构不符或截断的解析结果", async () => {
    await expect(
      analyzeSlideVision({
        imagePath: await imagePath(),
        imageMimeType: "image/png",
        ocr: OCR,
        referenceText: null,
        parseResponse: async () => ({
          id: "resp_malformed",
          model: OPENAI_VISION_MODEL,
          usage: null,
          // candidates 类型错误且缺少 pageRisks，模拟截断/结构不符响应。
          outputParsed: {
            schemaVersion: SCHEMA_VERSION,
            image: { width: 1600, height: 900 },
            candidates: "not-an-array",
            missingTextHints: [],
          },
          rawResponse: { id: "resp_malformed" },
        }),
      }),
    ).rejects.toThrow("Schema");
  });

  it("请求对象不包含认证字段", async () => {
    let serializedRequest = "";
    await analyzeSlideVision({
      imagePath: await imagePath(),
      imageMimeType: "image/png",
      ocr: OCR,
      referenceText: null,
      parseResponse: async (request) => {
        serializedRequest = JSON.stringify(request);
        return {
          id: "resp_test",
          model: OPENAI_VISION_MODEL,
          usage: null,
          outputParsed: {
            schemaVersion: SCHEMA_VERSION,
            image: { width: 1600, height: 900 },
            candidates: [],
            missingTextHints: [],
            pageRisks: [],
          },
          rawResponse: {},
        };
      },
    });
    expect(serializedRequest).not.toContain("apiKey");
    expect(serializedRequest).not.toContain("authorization");
    expect(serializedRequest).not.toContain("OPENAI_API_KEY");
  });
});
