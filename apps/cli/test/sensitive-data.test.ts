import { chmod, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { OPENAI_VISION_MODEL } from "../src/providers/openai-vision.js";
import { runSlideAnalyze } from "../src/slide/analyze.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import { createSlideWorkspace } from "../src/slide/workspace.js";

const SENTINEL_KEY = "sk-SENTINEL-must-not-persist-0123456789abcdef";

// 捕获真实 createDefaultParser 传给 OpenAI 客户端的 apiKey，证明真实读取密钥的路径确实执行过。
const openaiMock = vi.hoisted(() => ({ capturedApiKey: "" }));

vi.mock("openai", () => ({
  default: class {
    responses = {
      parse: async () => ({
        id: "resp_mock",
        model: OPENAI_VISION_MODEL,
        output_parsed: {
          schemaVersion: 1,
          image: { width: 1600, height: 900 },
          candidates: [],
          missingTextHints: [],
          pageRisks: [],
        },
        usage: { input_tokens: 1, output_tokens: 1 },
        status: "completed",
      }),
    };
    constructor(options: { apiKey: string }) {
      openaiMock.capturedApiKey = options.apiKey;
    }
  },
}));

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
    blocks: [
      {
        id: "block-1",
        text: "你好世界",
        bboxPx: { x: 120, y: 100, width: 480, height: 80 },
        confidence: 0.95,
        rotationDeg: null,
        glyphHints: [],
      },
    ],
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

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

describe("敏感信息不落盘", () => {
  it("analyze 流程后 API Key 与认证头不出现在任何工作区文件中", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-secret-"));
    const workspacePath = join(parent, "slide");
    const binaryPath = await createFakeVisionBinary(parent);
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
    await runSlideOcr({ workspacePath, binaryPath });

    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = SENTINEL_KEY;
    try {
      await runSlideAnalyze({
        workspacePath,
        confirmUpload: true,
        parseResponse: async () => ({
          id: "resp_secret",
          model: OPENAI_VISION_MODEL,
          usage: { input_tokens: 10, output_tokens: 5 },
          outputParsed: {
            schemaVersion: 1,
            image: { width: 1600, height: 900 },
            candidates: [],
            missingTextHints: [],
            pageRisks: [],
          },
          rawResponse: { id: "resp_secret", status: "completed" },
        }),
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }

    const files = await listFiles(workspacePath);
    // 覆盖 manifest、config、attempt、provider 记录、原始响应、结构化结果等全部写出文件。
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const content = await readFile(file, "utf8").catch(() => "");
      expect(content).not.toContain(SENTINEL_KEY);
      expect(content).not.toContain("OPENAI_API_KEY");
      expect(content).not.toContain("Authorization");
      expect(content).not.toContain("Bearer ");
    }
  });

  it("真实 createDefaultParser 路径（mock OpenAI SDK）也不把 API Key 写入任何产物", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-secret-real-"));
    const workspacePath = join(parent, "slide");
    const binaryPath = await createFakeVisionBinary(parent);
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });
    await runSlideOcr({ workspacePath, binaryPath });

    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = SENTINEL_KEY;
    try {
      // 不注入 parseResponse：走真实 createDefaultParser，触发 new OpenAI({apiKey}) 与响应解析。
      await runSlideAnalyze({ workspacePath, confirmUpload: true });
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }

    // 证明真实读取密钥的路径确实执行：mock 客户端收到的就是 sentinel key。
    expect(openaiMock.capturedApiKey).toBe(SENTINEL_KEY);

    const files = await listFiles(workspacePath);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const content = await readFile(file, "utf8").catch(() => "");
      expect(content).not.toContain(SENTINEL_KEY);
      expect(content).not.toContain("Authorization");
      expect(content).not.toContain("Bearer ");
    }
  });
});
