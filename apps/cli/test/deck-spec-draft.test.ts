import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentSpecSchema } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { runDeckGenerate } from "../src/deck/generate.js";
import { runDeckSpecDraft } from "../src/deck/spec-draft.js";
import type { OpenAiSpecDraftParser } from "../src/providers/openai-spec-draft.js";
import { fakeGenerator, fakePageImage } from "./deck-generate-fixtures.js";

const DRAFT = {
  style: { description: "深蓝主色、无衬线中文、大留白、几何线条点缀" },
  entries: [
    {
      pageType: "cover",
      textGroups: [
        { label: "标题", items: ["供应链协同数字化"] },
        { label: "副标题", items: ["端到端协同｜风险预警"] },
      ],
      visualIntent: "深色科技感背景，主标题居中偏左",
    },
    {
      pageType: "agenda",
      textGroups: [
        { label: "议题", items: ["项目理解", "总体方案", "实施计划"] },
      ],
      visualIntent: "三个编号卡片横排",
    },
  ],
};

function fakeParser(payload: unknown = DRAFT): OpenAiSpecDraftParser {
  return async () => ({
    id: "resp_fake",
    model: "gpt-5.6-luna",
    outputParsed: payload,
    usage: { input_tokens: 100, output_tokens: 400 },
  });
}

describe("deck spec-draft（C11）", () => {
  it("一次调用产出可直接被读取的合法规格，含分页与风格段", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-spec-draft-"));
    const fromPath = join(parent, "idea.txt");
    const outputPath = join(parent, "content-spec.json");
    await writeFile(
      fromPath,
      "做一份供应链协同数字化的投标方案，先封面再议题。",
      "utf8",
    );

    const result = await runDeckSpecDraft({
      fromPath,
      outputPath,
      confirmApi: true,
      parseResponse: fakeParser(),
    });

    // 落盘的文件本身必须过 ContentSpecSchema——这才是「可直接被 C1 读取」
    const onDisk = ContentSpecSchema.parse(
      JSON.parse(await readFile(outputPath, "utf8")),
    );
    expect(onDisk.entries.map((entry) => entry.specEntryId)).toEqual([
      "entry-001",
      "entry-002",
    ]);
    expect(onDisk.style.description).toContain("深蓝主色");
    expect(
      onDisk.entries.every((entry) => entry.revisionNotes.length === 0),
    ).toBe(true);
    expect(result.requestId).toBe("resp_fake");

    // 产出的规格直接能驱动生成
    const deckPath = join(parent, "deck");
    const generated = await runDeckGenerate({
      deckPath,
      specPath: outputPath,
      confirmUpload: true,
      generate: fakeGenerator(await fakePageImage()),
    });
    expect(generated.created).toHaveLength(2);
  }, 30_000);

  it("缺少 --confirm-api 时不访问网络", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-spec-draft-"));
    const fromPath = join(parent, "idea.txt");
    await writeFile(fromPath, "随便写点什么", "utf8");
    await expect(
      runDeckSpecDraft({
        fromPath,
        outputPath: join(parent, "spec.json"),
        confirmApi: false,
        parseResponse: async () => {
          throw new Error("不应该被调用");
        },
      }),
    ).rejects.toMatchObject({ code: "API_CONFIRMATION_REQUIRED" });
  });

  it("模型输出不合 Schema 时拒绝，不把自由文本当作规格", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-spec-draft-"));
    const fromPath = join(parent, "idea.txt");
    await writeFile(fromPath, "随便写点什么", "utf8");
    await expect(
      runDeckSpecDraft({
        fromPath,
        outputPath: join(parent, "spec.json"),
        confirmApi: true,
        parseResponse: fakeParser("我没法完成这个请求"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
});
