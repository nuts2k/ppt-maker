import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ContentSpec,
  DoctorReport,
  TextReviewDocument,
} from "@ppt-maker/core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { runAcceptClean } from "../src/clean/accept.js";
import { runSlideClean } from "../src/clean/run.js";
import { addSlideToDeck } from "../src/deck/add-slide.js";
import { loadDeckContentSpec } from "../src/deck/content-spec.js";
import { runDeckGenerate } from "../src/deck/generate.js";
import { currentGenerationAsset } from "../src/deck/generate-page.js";
import {
  formatDeckRegenerateResult,
  runDeckRegenerate,
} from "../src/deck/regenerate.js";
import { deckStatus } from "../src/deck/status.js";
import { runSlideMask } from "../src/mask/run.js";
import { runAcceptPptx } from "../src/pptx/accept.js";
import { runSlidePptx } from "../src/pptx/run.js";
import type { OpenAiImageEditor } from "../src/providers/openai-image.js";
import { runAcceptSource } from "../src/slide/accept-source.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import { replaceSlideSource } from "../src/slide/replace-source.js";
import { runSlideReview } from "../src/slide/review.js";
import { runSlideValidateReview } from "../src/slide/validate-review.js";
import {
  loadSlideWorkspace,
  writeWorkspaceManifest,
} from "../src/slide/workspace.js";
import {
  buildSpec,
  createFakeVisionBinary,
  entryAt,
  fakeGenerator,
  fakePageImage,
  writeSpecFile,
} from "./deck-generate-fixtures.js";

const FONT = "Microsoft YaHei";

/** 换源用的「自己的图」：与生成图不同来源，尺寸同为 16:9 */
function pngFixture(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

function fontReadyReport(): DoctorReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-01T00:00:00.000Z",
    checks: [
      {
        id: "font-microsoft-yahei",
        label: FONT,
        status: "pass",
        message: "test font available",
      },
    ],
    summary: { pass: 1, warn: 0, fail: 0 },
  };
}

async function buildFakeCleanPlate(
  sourcePath: string,
  maskPath: string,
): Promise<Buffer> {
  const src = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = await sharp(maskPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.from(src.data);
  for (let i = 0; i < src.info.width * src.info.height; i += 1) {
    if ((mask.data[i * 4 + 3] ?? 255) === 0) {
      out[i * 4] = 15;
      out[i * 4 + 1] = 26;
      out[i * 4 + 2] = 46;
    }
  }
  return sharp(out, {
    raw: { width: src.info.width, height: src.info.height, channels: 4 },
  })
    .resize(2048, 1152, { fit: "fill" })
    .png()
    .toBuffer();
}

function fakeEditor(cleanBuffer: Buffer): OpenAiImageEditor {
  return async () => ({
    response: {
      created: 0,
      data: [{ b64_json: cleanBuffer.toString("base64") }],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { image_tokens: 1, text_tokens: 0 },
      },
    } as never,
    requestId: "req_clean_fake",
  });
}

async function markAssistReviewCompleted(workspacePath: string): Promise<void> {
  const workspace = await loadSlideWorkspace(workspacePath);
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    stages: workspace.manifest.stages.map((state) =>
      state.stage === "assist-review"
        ? {
            ...state,
            status: "completed" as const,
            lastSuccessfulAttemptId: "assist-review-skip",
            completedInputFingerprint: "0".repeat(64),
          }
        : state,
    ),
  });
}

async function editReview(
  reviewPath: string,
  mutate: (document: TextReviewDocument) => void,
): Promise<void> {
  const document = JSON.parse(
    await readFile(reviewPath, "utf8"),
  ) as TextReviewDocument;
  mutate(document);
  await writeFile(reviewPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

interface GeneratedDeck {
  readonly parent: string;
  readonly deckPath: string;
  readonly specPath: string;
  readonly buffer: Buffer;
  readonly binaryPath: string;
}

async function setupGeneratedDeck(
  spec: ContentSpec = buildSpec(),
): Promise<GeneratedDeck> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-regen-"));
  const deckPath = join(parent, "deck");
  const specPath = await writeSpecFile(parent, spec);
  const buffer = await fakePageImage();
  await runDeckGenerate({
    deckPath,
    specPath,
    confirmUpload: true,
    generate: fakeGenerator(buffer),
  });
  const binaryPath = await createFakeVisionBinary(
    parent,
    "fake-vision",
    "全球营收概览",
  );
  return { parent, deckPath, specPath, buffer, binaryPath };
}

/** 把一页 generated 从源图确认一路跑到 accept-pptx */
async function runFullChain(
  workspacePath: string,
  binaryPath: string,
): Promise<void> {
  const before = await loadSlideWorkspace(workspacePath);
  if (
    before.manifest.stages.find((state) => state.stage === "accept-source")
      ?.status !== "completed"
  ) {
    await runAcceptSource({ workspacePath, acceptedBy: "test" });
  }
  await runSlideOcr({ workspacePath, binaryPath });
  const review = await runSlideReview({ workspacePath });
  await editReview(review.outputPath, (document) => {
    for (const block of document.blocks) {
      block.classification = "layout_text";
      block.includeInMask = true;
      block.reviewStatus = "reviewed";
      block.updatedAt = "2026-08-01T05:00:00.000Z";
      block.maskParams.foregroundColors = ["#ffffff"];
      block.maskParams.colorTolerance = 96;
    }
  });
  await markAssistReviewCompleted(workspacePath);
  await runSlideValidateReview({ workspacePath });
  await runSlideMask({ workspacePath });

  const workspace = await loadSlideWorkspace(workspacePath);
  const cleanBuffer = await buildFakeCleanPlate(
    join(workspacePath, workspace.config.sourceImagePath),
    join(workspacePath, "stages/mask/mask.png"),
  );
  await runSlideClean({
    workspacePath,
    confirmUpload: true,
    edit: fakeEditor(cleanBuffer),
  });
  await runAcceptClean({ workspacePath, acceptedBy: "test" });
  await runSlidePptx({
    workspacePath,
    fontFace: FONT,
    doctorReport: fontReadyReport(),
  });
  await runAcceptPptx({ workspacePath, acceptedBy: "test" });
}

describe("deck regenerate（C5 覆盖形状不可简化）", () => {
  it("跑完整链路到 accept-pptx 的页重生成后，下游能继续跑到 pptx 成功", async () => {
    const { deckPath, buffer, binaryPath } = await setupGeneratedDeck();
    const workspacePath = join(deckPath, "slides/page-01");

    await runFullChain(workspacePath, binaryPath);
    const accepted = await loadSlideWorkspace(workspacePath);
    expect(
      accepted.manifest.stages.find((s) => s.stage === "accept-pptx")?.status,
    ).toBe("completed");

    const regenerated = await runDeckRegenerate({
      deckPath,
      page: "page-01",
      note: "标题再大一点",
      confirmUpload: true,
      generate: fakeGenerator(buffer, "req_regen"),
    });
    expect(regenerated.attemptId).toBe("init-002");
    // 换源让源图确认及下游全部失效，且新来源仍需人工确认
    expect(regenerated.invalidated).toContain("accept-pptx");
    expect(regenerated.requiresAcceptance).toBe(true);

    // 参考文案跟着规格走：新 reference 资产成为当前，旧的保留供追溯（R9）
    const afterReplace = await loadSlideWorkspace(workspacePath);
    expect(afterReplace.config.referenceTextPath).toBe(
      "inputs/reference-2.txt",
    );
    expect(
      afterReplace.manifest.assets.filter(
        (asset) => asset.role === "reference_text",
      ),
    ).toHaveLength(2);
    expect(
      afterReplace.manifest.assets.find(
        (asset) => asset.id === afterReplace.manifest.referenceTextAssetId,
      )?.path,
    ).toBe("inputs/reference-2.txt");

    // **不止验到「重生成成功」**：继续跑 ocr → review → mask → pptx 必须成功
    await runFullChain(workspacePath, binaryPath);
    const final = await loadSlideWorkspace(workspacePath);
    expect(final.manifest.stages.find((s) => s.stage === "pptx")?.status).toBe(
      "completed",
    );
    expect(
      final.manifest.stages.find((s) => s.stage === "accept-pptx")?.status,
    ).toBe("completed");
  }, 120_000);
});

describe("deck regenerate 的说明累积（C6）", () => {
  it("三次重生成后三条说明按序全在，提示词含全部三条，其它条目零变化", async () => {
    const { deckPath, buffer } = await setupGeneratedDeck();
    const notes = ["标题再大一点", "配色改深蓝", "去掉底部渐变"];
    for (const [index, note] of notes.entries()) {
      await runDeckRegenerate({
        deckPath,
        page: "page-01",
        note,
        confirmUpload: true,
        generate: fakeGenerator(buffer, `req_regen_${index}`),
      });
    }

    const spec = await loadDeckContentSpec(deckPath);
    expect(spec?.entries[0]?.revisionNotes).toEqual(notes);
    // 该条目之外的内容零变化
    expect(spec?.entries[1]).toEqual(buildSpec().entries[1]);

    const workspace = await loadSlideWorkspace(
      join(deckPath, "slides/page-01"),
    );
    const promptAsset = currentGenerationAsset(
      workspace.manifest,
      "generation_prompt",
    );
    const prompt = await readFile(
      join(workspace.path, promptAsset?.path ?? ""),
      "utf8",
    );
    expect(prompt).toContain("later ones take precedence");
    expect(prompt).toContain("1. 标题再大一点");
    expect(prompt).toContain("2. 配色改深蓝");
    expect(prompt).toContain("3. 去掉底部渐变");

    // 刚生成完不该显示漂移：specEntrySha256 用的是追加说明之后的指纹
    const status = await deckStatus(deckPath);
    expect(status.slides[0]?.specDrift).toBe("in-sync");
  }, 60_000);
});

describe("多代资产的当前产物判据（C9）", () => {
  it("重生成过两次的页上，content_spec 恰好 3 条且读到的是最新那条", async () => {
    const { deckPath, buffer } = await setupGeneratedDeck();
    await runDeckRegenerate({
      deckPath,
      page: "page-01",
      note: "第一次调整",
      confirmUpload: true,
      generate: fakeGenerator(buffer, "req_a"),
    });
    await runDeckRegenerate({
      deckPath,
      page: "page-01",
      note: "第二次调整",
      confirmUpload: true,
      generate: fakeGenerator(buffer, "req_b"),
    });

    const workspace = await loadSlideWorkspace(
      join(deckPath, "slides/page-01"),
    );
    // **前置断言**：fixture 确实是那种危险形态，否则用例可能什么都没覆盖
    const specAssets = workspace.manifest.assets.filter(
      (asset) => asset.role === "content_spec",
    );
    expect(specAssets).toHaveLength(3);
    expect(specAssets.map((asset) => asset.attemptId)).toEqual([
      "init-001",
      "init-002",
      "init-003",
    ]);
    // 裸 find 拿到的是第一代——这正是要避免的写法
    expect(specAssets[0]?.attemptId).toBe("init-001");

    const current = currentGenerationAsset(workspace.manifest, "content_spec");
    expect(current?.attemptId).toBe("init-003");
    const view = JSON.parse(
      await readFile(join(workspace.path, current?.path ?? ""), "utf8"),
    );
    expect(view.entry.revisionNotes).toEqual(["第一次调整", "第二次调整"]);

    for (const role of ["generation_prompt", "provider_record"] as const) {
      expect(
        workspace.manifest.assets.filter((asset) => asset.role === role),
      ).toHaveLength(3);
      expect(currentGenerationAsset(workspace.manifest, role)?.attemptId).toBe(
        "init-003",
      );
    }
  }, 60_000);
});

describe("规格漂移只读（C8）", () => {
  it("改一条条目只有该页漂移、全部页阶段状态不变，改回原样标注消失", async () => {
    const { parent, deckPath, buffer, binaryPath } = await setupGeneratedDeck();
    await runAcceptSource({
      workspacePath: join(deckPath, "slides/page-01"),
      acceptedBy: "test",
    });
    await runSlideOcr({
      workspacePath: join(deckPath, "slides/page-01"),
      binaryPath,
    });

    const stagesOf = async (page: string): Promise<string> =>
      JSON.stringify(
        (await loadSlideWorkspace(join(deckPath, `slides/${page}`))).manifest
          .stages,
      );
    const before = [await stagesOf("page-01"), await stagesOf("page-02")];

    const spec = buildSpec();
    const edited: ContentSpec = {
      ...spec,
      entries: [
        {
          ...entryAt(spec, 0),
          visualIntent: "改成左对齐大标题",
        },
        entryAt(spec, 1),
      ],
    };
    await writeFile(
      join(deckPath, "content-spec.json"),
      `${JSON.stringify(edited, null, 2)}\n`,
      "utf8",
    );

    const drifted = await deckStatus(deckPath);
    expect(drifted.slides.map((slide) => slide.specDrift)).toEqual([
      "drifted",
      "in-sync",
    ]);
    // 只读派生：所有页阶段状态一个都没变
    expect([await stagesOf("page-01"), await stagesOf("page-02")]).toEqual(
      before,
    );

    // 改回原样，标注自动消失（不需要状态复位逻辑）
    await writeFile(
      join(deckPath, "content-spec.json"),
      `${JSON.stringify(spec, null, 2)}\n`,
      "utf8",
    );
    const restored = await deckStatus(deckPath);
    expect(restored.slides.map((slide) => slide.specDrift)).toEqual([
      "in-sync",
      "in-sync",
    ]);

    // 改 style 则全部 generated 页漂移
    await writeFile(
      join(deckPath, "content-spec.json"),
      `${JSON.stringify({ ...spec, style: { description: "暖橙主色" } }, null, 2)}\n`,
      "utf8",
    );
    const restyled = await deckStatus(deckPath);
    expect(restyled.slides.map((slide) => slide.specDrift)).toEqual([
      "drifted",
      "drifted",
    ]);
    expect([await stagesOf("page-01"), await stagesOf("page-02")]).toEqual(
      before,
    );
    expect(parent).toBeTruthy();
    expect(buffer.byteLength).toBeGreaterThan(0);
  }, 60_000);

  it("规格里删掉条目后该页报失联而非漂移", async () => {
    const { deckPath } = await setupGeneratedDeck();
    const spec = buildSpec();
    await writeFile(
      join(deckPath, "content-spec.json"),
      `${JSON.stringify({ ...spec, entries: [spec.entries[0]] }, null, 2)}\n`,
      "utf8",
    );
    const status = await deckStatus(deckPath);
    expect(status.slides.map((slide) => slide.specDrift)).toEqual([
      "in-sync",
      "missing",
    ]);
  });
});

/**
 * A11 正向：`imported` → `generated`。
 *
 * 反向（generated → imported）早就通了，正向此前**根本没有路**——`deck regenerate`
 * 要求 `source.kind === "generated"`，`deck replace-source` 只收图片文件，于是一页
 * 一旦换成导入就再也回不去（2026-08-02 阶段三走查实测报
 * 「只有生成来源的页可以重新生成，该页来源是：imported」并以退出码 1 结束）。
 *
 * 这与 design §4.5〈换源后的重新判定〉直接相悖：「换源统一走一条路径，而这条路径
 * 按新来源决定是否需要重新确认，不需要为『重新生成』单开分支」。
 */
describe("换源为生成来源（A11 正向）", () => {
  it("换成导入图的页能换回生成来源，并重新回到待确认", async () => {
    const { deckPath, buffer } = await setupGeneratedDeck();
    const workspacePath = join(deckPath, "slides/page-01");

    await runAcceptSource({ workspacePath, acceptedBy: "test" });
    await replaceSlideSource({ workspacePath, imagePath: pngFixture() });

    // **前置断言**：确实处在缺陷现场——当前来源已是 imported、已自动放行
    const imported = await loadSlideWorkspace(workspacePath);
    expect(imported.manifest.source.kind).toBe("imported");
    const importedStatus = await deckStatus(deckPath);
    expect(importedStatus.slides[0]?.sourceKind).toBe("imported");
    expect(importedStatus.slides[0]?.sourceAcceptance).toBe("auto");
    // 当前来源不是生成，故 specEntryId 为 null；但历史快照还在，仍换得回去
    expect(importedStatus.slides[0]?.specEntryId).toBeNull();
    expect(importedStatus.slides[0]?.regenerableSpecEntryId).toBe("entry-001");

    const otherBefore = JSON.stringify(
      (await loadSlideWorkspace(join(deckPath, "slides/page-02"))).manifest,
    );

    const result = await runDeckRegenerate({
      deckPath,
      page: "page-01",
      note: "换回生成来源",
      confirmUpload: true,
      generate: fakeGenerator(buffer, "req_back_to_generated"),
    });
    expect(result.previousSourceKind).toBe("imported");
    expect(result.specEntryId).toBe("entry-001");
    expect(result.requiresAcceptance, "生成图必须重新确认").toBe(true);
    expect(formatDeckRegenerateResult(result)).toContain(
      "来源已由 imported 换回 generated",
    );

    const after = await loadSlideWorkspace(workspacePath);
    expect(after.manifest.source.kind).toBe("generated");
    // init 刚刚成功，绝不能被标 stale；源图确认回到「欠一次」
    expect(
      after.manifest.stages.find((state) => state.stage === "init")?.status,
    ).toBe("completed");
    expect(
      after.manifest.stages.find((state) => state.stage === "accept-source")
        ?.status,
      "换回生成来源必须重新欠一次人工确认",
    ).not.toBe("completed");
    expect((await deckStatus(deckPath)).slides[0]?.sourceAcceptance).toBe(
      "pending",
    );
    // 说明照常写回规格条目
    expect(
      (await loadDeckContentSpec(deckPath))?.entries[0]?.revisionNotes,
    ).toEqual(["换回生成来源"]);

    // 失效只作用于本页
    expect(
      JSON.stringify(
        (await loadSlideWorkspace(join(deckPath, "slides/page-02"))).manifest,
      ),
    ).toBe(otherBefore);
  }, 60_000);

  it("从未生成过的导入页必须显式给 --spec-entry，错误里列出可用条目", async () => {
    const { deckPath, buffer } = await setupGeneratedDeck();
    // 往同一个 deck 里追加一页纯导入（从没跟规格沾过边）
    const added = await addSlideToDeck({ deckPath, imagePath: pngFixture() });
    expect(added.pageLabel).toBe("page-03");

    const status = await deckStatus(deckPath);
    expect(
      status.slides[2]?.regenerableSpecEntryId,
      "没有任何生成快照的页不该被推断出条目",
    ).toBeNull();

    await expect(
      runDeckRegenerate({
        deckPath,
        page: "page-03",
        confirmUpload: true,
        generate: fakeGenerator(buffer, "req_no_entry"),
      }),
      // 关键是**不能猜**：没有依据时报错并告诉用户有哪些条目可选
    ).rejects.toThrow(/--spec-entry.*entry-001, entry-002/su);

    const result = await runDeckRegenerate({
      deckPath,
      page: "page-03",
      specEntryId: "entry-002",
      confirmUpload: true,
      generate: fakeGenerator(buffer, "req_explicit_entry"),
    });
    expect(result.specEntryId).toBe("entry-002");
    expect(result.previousSourceKind).toBe("imported");
    expect(result.requiresAcceptance).toBe(true);

    const workspace = await loadSlideWorkspace(
      join(deckPath, "slides/page-03"),
    );
    expect(workspace.manifest.source.kind).toBe("generated");
    expect(
      workspace.manifest.source.kind === "generated" &&
        workspace.manifest.source.specEntryId,
    ).toBe("entry-002");
  }, 60_000);

  it("显式给了规格里不存在的条目时报错并列出可用条目", async () => {
    const { deckPath, buffer } = await setupGeneratedDeck();
    await expect(
      runDeckRegenerate({
        deckPath,
        page: "page-01",
        specEntryId: "entry-999",
        confirmUpload: true,
        generate: fakeGenerator(buffer, "req_bad_entry"),
      }),
    ).rejects.toThrow(/entry-999.*entry-001, entry-002/su);
  }, 60_000);
});
