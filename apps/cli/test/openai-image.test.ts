import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import {
  buildCleanPlateEditParams,
  CLEAN_PLATE_HEIGHT,
  CLEAN_PLATE_OUTPUT_FORMAT,
  CLEAN_PLATE_QUALITY,
  CLEAN_PLATE_SIZE,
  CLEAN_PLATE_WIDTH,
  cleanPlateMatchesWideRatio,
  extractCleanPlateResult,
  OPENAI_IMAGE_MODEL,
} from "../src/providers/openai-image.js";

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

describe("gpt-image-2 类型契约", () => {
  it("固定 design 约定的模型与档位常量", () => {
    expect(OPENAI_IMAGE_MODEL).toBe("gpt-image-2");
    expect(CLEAN_PLATE_SIZE).toBe("2048x1152");
    expect(CLEAN_PLATE_QUALITY).toBe("high");
    expect(CLEAN_PLATE_OUTPUT_FORMAT).toBe("png");
    expect([CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT]).toEqual([2048, 1152]);
    expect(cleanPlateMatchesWideRatio()).toBe(true);
  });

  it("构造的 images.edit 请求为类型契约合法的非流式参数", () => {
    // 返回类型标注为 OpenAI.Images.ImageEditParamsNonStreaming：
    // 若模型/尺寸/质量/输出格式字面量不被 SDK 类型接受，此处会 typecheck 失败。
    const params = buildCleanPlateEditParams({
      image: createReadStream(fixturePath()),
      mask: createReadStream(fixturePath()),
      prompt: "移除独立版式文字字形，保留容器与对象内符号",
    });

    expect(params.model).toBe("gpt-image-2");
    expect(params.size).toBe("2048x1152");
    expect(params.quality).toBe("high");
    expect(params.output_format).toBe("png");
    expect(params.n).toBe(1);
    expect(params.stream).toBe(false);
    expect(params.image).toBeDefined();
    expect(params.mask).toBeDefined();
    // M1 不设置 input_fidelity。
    expect("input_fidelity" in params).toBe(false);
  });

  it("从响应提取 base64 PNG 与用量", () => {
    const response: OpenAI.Images.ImagesResponse = {
      created: 0,
      data: [{ b64_json: "iVBORw0KGgo=" }],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        total_tokens: 300,
        input_tokens_details: { image_tokens: 80, text_tokens: 20 },
      },
    };
    const result = extractCleanPlateResult(response);
    expect(result.b64Png).toBe("iVBORw0KGgo=");
    expect(result.usage?.total_tokens).toBe(300);
  });

  it("响应缺少图片数据时抛出 Provider 响应错误", () => {
    const response: OpenAI.Images.ImagesResponse = { created: 0, data: [] };
    expect(() => extractCleanPlateResult(response)).toThrow("base64");
  });
});
