import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProviderCallRecordSchema, SCHEMA_VERSION } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  OPENAI_VISION_MODEL,
  VISION_ANALYSIS_PROMPT_VERSION,
} from "../src/providers/openai-vision.js";
import { runSlideAnalyze } from "../src/slide/analyze.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import {
  createSlideWorkspace,
  loadSlideWorkspace,
} from "../src/slide/workspace.js";

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

async function createFakeVisionBinary(directory: string): Promise<string> {
  const path = join(directory, "fake-vision");
  const response = {
    schemaVersion: 1,
    provider: "apple-vision",
    image: { width: 1600, height: 900 },
    blocks: [],
  };
  await writeFile(
    path,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(
      JSON.stringify(response),
    )});\n`,
    "utf8",
  );
  await chmod(path, 0o755);
  return path;
}

async function createOcrWorkspace(parent: string): Promise<string> {
  const workspacePath = join(parent, "slide");
  const binaryPath = await createFakeVisionBinary(parent);
  await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
  await runSlideOcr({ workspacePath, binaryPath });
  return workspacePath;
}

function parsedResult() {
  return {
    schemaVersion: SCHEMA_VERSION,
    image: { width: 1600, height: 900 },
    candidates: [],
    missingTextHints: [],
    pageRisks: [],
  };
}

describe("slide analyze", () => {
  it("没有显式确认时拒绝上传", async () => {
    await expect(
      runSlideAnalyze({
        workspacePath: "/unused",
        confirmUpload: false,
      }),
    ).rejects.toThrow("--confirm-upload");
  });

  it("保存结构化结果、原始响应和 Provider 记录，并复用相同输入", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-analyze-"));
    const workspacePath = await createOcrWorkspace(parent);
    const notices: string[] = [];
    let calls = 0;
    const parseResponse = async () => {
      calls += 1;
      return {
        id: "resp_analyze_test",
        model: OPENAI_VISION_MODEL,
        usage: { input_tokens: 100, output_tokens: 50 },
        outputParsed: parsedResult(),
        rawResponse: { id: "resp_analyze_test", status: "completed" },
      };
    };

    const first = await runSlideAnalyze({
      workspacePath,
      confirmUpload: true,
      parseResponse,
      onBeforeUpload: (notice) => notices.push(notice.model),
    });
    const second = await runSlideAnalyze({
      workspacePath,
      confirmUpload: true,
      parseResponse,
      onBeforeUpload: (notice) => notices.push(notice.model),
    });
    const loaded = await loadSlideWorkspace(workspacePath);
    const providerRecord = await readFile(
      join(workspacePath, "stages/analyze/analyze-001/provider.json"),
      "utf8",
    );

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(calls).toBe(1);
    expect(notices).toEqual([OPENAI_VISION_MODEL]);
    expect(providerRecord).toContain('"detail": "original"');
    expect(providerRecord).toContain('"reasoningEffort": "high"');
    expect(providerRecord).not.toContain("OPENAI_API_KEY");
    expect(providerRecord).toMatch(/"rawResponseSha256": "[a-f0-9]{64}"/u);
    expect(providerRecord).toMatch(/"parsedResponseSha256": "[a-f0-9]{64}"/u);
    expect(
      loaded.manifest.stages.find((stage) => stage.stage === "analyze"),
    ).toMatchObject({
      status: "completed",
      lastSuccessfulAttemptId: "analyze-001",
    });
    expect(
      loaded.manifest.assets.filter(
        (asset) => asset.attemptId === "analyze-001",
      ),
    ).toHaveLength(3);
  });

  it("Provider 记录保存用量、请求标识与仅含哈希的发送资产", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-analyze-"));
    const workspacePath = await createOcrWorkspace(parent);
    await runSlideAnalyze({
      workspacePath,
      confirmUpload: true,
      parseResponse: async () => ({
        id: "resp_meta",
        model: OPENAI_VISION_MODEL,
        usage: { input_tokens: 321, output_tokens: 123 },
        outputParsed: parsedResult(),
        rawResponse: { id: "resp_meta", status: "completed" },
      }),
    });

    const record = ProviderCallRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(workspacePath, "stages/analyze/analyze-001/provider.json"),
          "utf8",
        ),
      ),
    );

    expect(record.requestId).toBe("resp_meta");
    expect(record.model).toBe(OPENAI_VISION_MODEL);
    expect(record.promptVersion).toBe(VISION_ANALYSIS_PROMPT_VERSION);
    expect(record.usage).toMatchObject({
      input_tokens: 321,
      output_tokens: 123,
    });
    expect(record.durationMs).not.toBeNull();
    expect(record.error).toBeNull();
    // 发送资产只记录相对路径与哈希，不落盘图片内容。
    expect(record.sentAssets.length).toBeGreaterThan(0);
    for (const asset of record.sentAssets) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(Object.keys(asset).sort()).toEqual(["path", "sha256"]);
    }
  });

  it("调用失败时保存 Provider 错误记录且不生成分析结果", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-analyze-"));
    const workspacePath = await createOcrWorkspace(parent);

    await expect(
      runSlideAnalyze({
        workspacePath,
        confirmUpload: true,
        parseResponse: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).rejects.toThrow("provider unavailable");
    const loaded = await loadSlideWorkspace(workspacePath);
    const providerRecord = ProviderCallRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(workspacePath, "stages/analyze/analyze-001/provider.json"),
          "utf8",
        ),
      ),
    );

    expect(providerRecord.error?.message).toBe("provider unavailable");
    expect(
      loaded.manifest.stages.find((stage) => stage.stage === "analyze")?.status,
    ).toBe("failed");
    expect(
      loaded.manifest.assets.filter(
        (asset) => asset.role === "analysis_result",
      ),
    ).toHaveLength(0);
    expect(
      loaded.manifest.assets.filter(
        (asset) => asset.role === "provider_record",
      ),
    ).toHaveLength(1);
  });

  it("错误消息内含 API Key 时落盘前脱敏为 [REDACTED]", async () => {
    const sentinelKey = "sk-SENTINEL-error-message-0123456789abcdef";
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-analyze-"));
    const workspacePath = await createOcrWorkspace(parent);

    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = sentinelKey;
    try {
      await expect(
        runSlideAnalyze({
          workspacePath,
          confirmUpload: true,
          parseResponse: async () => {
            throw new Error(`上游返回 401，key=${sentinelKey} 无效`);
          },
        }),
      ).rejects.toThrow();
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }

    const providerRecord = ProviderCallRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(workspacePath, "stages/analyze/analyze-001/provider.json"),
          "utf8",
        ),
      ),
    );
    expect(providerRecord.error?.message).not.toContain(sentinelKey);
    expect(providerRecord.error?.message).toContain("[REDACTED]");
  });
});
