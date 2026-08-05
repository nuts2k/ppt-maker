import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { ContentSpec, TextReviewDocument } from "@ppt-maker/core";
import { imageSize } from "image-size";
import { describe, expect, it } from "vitest";
import { runDeckGenerate } from "../src/deck/generate.js";
import { deckStatus } from "../src/deck/status.js";
import {
  createDeckWorkspace,
  createEmptyDeckWorkspace,
  loadDeckWorkspace,
  writeDeckManifest,
} from "../src/deck/workspace.js";
import type { OpenAiImageGenerator } from "../src/providers/openai-image.js";
import {
  buildPageGenerationPrompt,
  specViewFingerprint,
} from "../src/providers/page-generation.js";
import { runAcceptSource } from "../src/slide/accept-source.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import { runSlideReview } from "../src/slide/review.js";
import {
  createSlideWorkspace,
  loadSlideWorkspace,
} from "../src/slide/workspace.js";
import {
  buildSpec,
  createFakeVisionBinary,
  entryAt,
  fakeGenerator,
  fakePageImage,
  GATEWAY_HEIGHT,
  GATEWAY_WIDTH,
  writeSpecFile,
} from "./deck-generate-fixtures.js";

async function setupDeck(spec = buildSpec()): Promise<{
  parent: string;
  deckPath: string;
  specPath: string;
  buffer: Buffer;
}> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-generate-"));
  return {
    parent,
    deckPath: join(parent, "deck"),
    specPath: await writeSpecFile(parent, spec),
    buffer: await fakePageImage(),
  };
}

describe("deck generate（C2 / C3）", () => {
  it("由 N 条条目建出 N 页，来源字段齐备且 deck status 逐页显示来源", async () => {
    const { deckPath, specPath, buffer } = await setupDeck();
    const spec = buildSpec();

    const result = await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });

    expect(result.created.map((page) => page.pageLabel)).toEqual([
      "page-01",
      "page-02",
    ]);
    expect(result.failed).toEqual([]);

    const first = await loadSlideWorkspace(join(deckPath, "slides/page-01"));
    const source = first.manifest.source;
    if (source.kind !== "generated") {
      throw new Error("第 1 页来源应为 generated");
    }
    expect(source.specEntryId).toBe("entry-001");
    expect(source.specEntrySha256).toBe(
      specViewFingerprint(spec.style, entryAt(spec, 0)),
    );
    expect(source.model).toBe("gpt-image-2");
    expect(source.promptVersion).toBe("m5-generate-v1");
    expect(source.promptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(source.attemptId).toBe("init-001");

    // 提示词全文与规格视图快照都在，且挂在这一次 init attempt 上
    const promptAsset = first.manifest.assets.find(
      (asset) => asset.role === "generation_prompt",
    );
    expect(promptAsset?.attemptId).toBe("init-001");
    expect(promptAsset?.sha256).toBe(source.promptSha256);
    const specAsset = first.manifest.assets.find(
      (asset) => asset.role === "content_spec",
    );
    expect(specAsset?.attemptId).toBe("init-001");
    const view = JSON.parse(
      await readFile(join(first.path, specAsset?.path ?? ""), "utf8"),
    );
    // 合并视图 `{style, entry}` 而非裸条目——资产内容与指纹覆盖范围一致
    expect(view.style).toEqual(spec.style);
    expect(view.entry.specEntryId).toBe("entry-001");

    const provider = JSON.parse(
      await readFile(
        join(
          first.path,
          first.manifest.assets.find(
            (asset) => asset.role === "provider_record",
          )?.path ?? "",
        ),
        "utf8",
      ),
    );
    expect(provider.stage).toBe("init");
    expect(provider.model).toBe("gpt-image-2");
    expect(provider.usage.output_tokens).toBe(1158);
    expect(provider.requestId).toBe("req_generate_fake");

    const status = await deckStatus(deckPath);
    expect(status.slides.map((slide) => slide.sourceKind)).toEqual([
      "generated",
      "generated",
    ]);
    expect(status.slides.map((slide) => slide.specDrift)).toEqual([
      "in-sync",
      "in-sync",
    ]);
    // generated 页停在源图确认闸门，还没动过下游
    expect(status.summary.notStarted).toBe(2);
  });

  it("C3 资产尺寸取自落盘 PNG 的实际像素，不是请求参数", async () => {
    const { deckPath, specPath, buffer } = await setupDeck();
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });

    const workspace = await loadSlideWorkspace(
      join(deckPath, "slides/page-01"),
    );
    const asset = workspace.manifest.assets.find(
      (candidate) => candidate.id === workspace.manifest.sourceImageAssetId,
    );
    const onDisk = imageSize(
      await readFile(join(workspace.path, asset?.path ?? "")),
    );

    expect(asset?.image).toEqual({
      width: onDisk.width,
      height: onDisk.height,
      format: "png",
    });
    // 请求的是 2048x1152，网关给的是 1672x941——写死请求参数会在这里当场翻车
    expect(asset?.image?.width).toBe(GATEWAY_WIDTH);
    expect(asset?.image?.height).toBe(GATEWAY_HEIGHT);
    expect(asset?.image?.width).not.toBe(2048);
  });
});

describe("deck generate 的 reference_text（C4）", () => {
  it("参考文案等于 textGroups 展平结果，且视觉意图不进候选", async () => {
    const { parent, deckPath, specPath, buffer } = await setupDeck();
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });

    const workspacePath = join(deckPath, "slides/page-01");
    const workspace = await loadSlideWorkspace(workspacePath);
    expect(workspace.config.referenceTextPath).toBe("inputs/reference.txt");
    const reference = await readFile(
      join(workspacePath, workspace.config.referenceTextPath ?? ""),
      "utf8",
    );
    expect(reference).toBe("全球营收概览\n2026 年度回顾\n");

    // 规格文字作为候选参与匹配；视觉意图一个字都不该出现在候选里
    await runAcceptSource({ workspacePath, acceptedBy: "test" });
    const binaryPath = await createFakeVisionBinary(
      parent,
      "fake-vision",
      "全球营收概览",
    );
    await runSlideOcr({ workspacePath, binaryPath });
    const review = await runSlideReview({ workspacePath });
    const document = JSON.parse(
      await readFile(review.outputPath, "utf8"),
    ) as TextReviewDocument;

    expect(
      document.blocks[0]?.sources.some(
        (source) => source.kind === "reference_text",
      ),
    ).toBe(true);
    const unmatched = document.unmatchedReferenceCandidates.map(
      (candidate) => candidate.text,
    );
    expect(unmatched).toEqual(["2026 年度回顾"]);
    for (const candidate of unmatched) {
      expect(candidate).not.toContain("居中大标题");
      expect(candidate).not.toContain("渐变");
    }
  });
});

describe("deck generate 的对账与追加（C10 / C14）", () => {
  it("C14 往已含 imported 页的 deck 追加，既有页零改动且不参与对账", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-mixed-"));
    const imagesDir = join(parent, "images");
    await mkdir(imagesDir, { recursive: true });
    await writeFile(join(imagesDir, "a.png"), await fakePageImage(1600, 900));
    const deckPath = join(parent, "deck");
    await createDeckWorkspace({ imagesDir, workspacePath: deckPath });

    const beforeImported = await readFile(
      join(deckPath, "slides/page-01/manifest.json"),
      "utf8",
    );

    const specPath = await writeSpecFile(parent, buildSpec());
    const result = await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(await fakePageImage()),
    });

    // 生成页接在末尾，page-NN 不重排
    expect(result.created.map((page) => page.pageLabel)).toEqual([
      "page-02",
      "page-03",
    ]);
    // 既有导入页逐字节未变
    expect(
      await readFile(join(deckPath, "slides/page-01/manifest.json"), "utf8"),
    ).toBe(beforeImported);
    // 对账里不含任何 imported 页——它们没有 specEntryId，不参与对账
    expect(result.reconciliation.missingPages).toEqual([]);
    expect(result.reconciliation.drifted).toEqual([]);

    const status = await deckStatus(deckPath);
    expect(status.slides.map((slide) => slide.sourceKind)).toEqual([
      "imported",
      "generated",
      "generated",
    ]);
    expect(status.slides[0]?.specDrift).toBeNull();
  });

  it("C14 extracted 页同样不参与对账，重跑不把它报成失联", async () => {
    // 直接构造 extracted 来源的页，不依赖 PDF 原生二进制：这里要锁的不变量是
    // 「非 generated 页永远不进对账」，与那一页的图从哪来无关。
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-extracted-"));
    const deckPath = join(parent, "deck");
    await createEmptyDeckWorkspace({ workspacePath: deckPath });

    const imagePath = join(parent, "extracted.png");
    await writeFile(imagePath, await fakePageImage());
    const extracted = await createSlideWorkspace({
      imagePath,
      workspacePath: join(deckPath, "slides/page-01"),
      source: {
        kind: "extracted",
        documentName: "deck.pdf",
        documentSha256: "b".repeat(64),
        pageNumber: 1,
        hasExtractableText: true,
        rendererId: "macos-pdfkit",
        rendererVersion: "1+test",
        renderDpi: 205,
      },
    });
    const deck = await loadDeckWorkspace(deckPath);
    await writeDeckManifest(deckPath, {
      ...deck.manifest,
      slides: [
        {
          slideId: extracted.manifest.slideId,
          workspacePath: "slides/page-01",
          sourceImageName: "deck.pdf#1",
          addedAt: "2026-08-01T00:00:00.000Z",
          removedAt: null,
        },
      ],
    });
    const beforeExtracted = await readFile(
      join(deckPath, "slides/page-01/manifest.json"),
      "utf8",
    );

    const specPath = await writeSpecFile(parent, buildSpec());
    const first = await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(await fakePageImage()),
    });
    expect(first.created.map((page) => page.pageLabel)).toEqual([
      "page-02",
      "page-03",
    ]);

    // 重跑一次：extracted 页没有 specEntryId，绝不能被报成「失联」
    const rerun = await runDeckGenerate({
      deckPath,
      confirmUpload: true,
      generate: fakeGenerator(await fakePageImage()),
    });
    expect(rerun.created).toEqual([]);
    expect(rerun.reconciliation.missingPages).toEqual([]);
    expect(rerun.reconciliation.drifted).toEqual([]);
    expect(
      await readFile(join(deckPath, "slides/page-01/manifest.json"), "utf8"),
    ).toBe(beforeExtracted);

    const status = await deckStatus(deckPath);
    expect(status.slides.map((slide) => slide.sourceKind)).toEqual([
      "extracted",
      "generated",
      "generated",
    ]);
    expect(status.slides[0]?.specEntryId).toBeNull();
    expect(status.slides[0]?.specDrift).toBeNull();
  });

  it("C10 加一条删一条后重跑：如实报告新增与失联，失联页原封不动", async () => {
    const { parent, deckPath, specPath, buffer } = await setupDeck();
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });
    const beforeMissing = await readFile(
      join(deckPath, "slides/page-02/manifest.json"),
      "utf8",
    );

    // 删掉 entry-002（对应 page-02），加一条 entry-003
    const spec = buildSpec();
    const edited: ContentSpec = {
      ...spec,
      entries: [
        entryAt(spec, 0),
        {
          specEntryId: "entry-003",
          pageType: "summary",
          textGroups: [{ label: "结语", items: ["谢谢"] }],
          visualIntent: "居中单行",
          revisionNotes: [],
        },
      ],
    };
    const editedPath = await writeSpecFile(join(parent), edited);

    const rerun = await runDeckGenerate({
      deckPath,
      specPath: editedPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });

    expect(rerun.reconciliation.newEntries.map((e) => e.specEntryId)).toEqual([
      "entry-003",
    ]);
    expect(
      rerun.reconciliation.missingPages.map((page) => page.specEntryId),
    ).toEqual(["entry-002"]);
    expect(rerun.created.map((page) => page.pageLabel)).toEqual(["page-03"]);
    // 失联页原封不动：阶段状态与产物零变化
    expect(
      await readFile(join(deckPath, "slides/page-02/manifest.json"), "utf8"),
    ).toBe(beforeMissing);
  });

  it("断点续跑：已存在且 specEntryId 匹配的条目被跳过", async () => {
    const { deckPath, specPath, buffer } = await setupDeck();
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });
    const rerun = await runDeckGenerate({
      deckPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });
    expect(rerun.created).toEqual([]);
    expect(rerun.skipped).toEqual(["entry-001", "entry-002"]);
  });

  it("单页失败不中断整批", async () => {
    const { deckPath, specPath, buffer } = await setupDeck();
    let call = 0;
    const flaky: OpenAiImageGenerator = async (params) => {
      call += 1;
      if (call === 1) {
        throw new Error("网关限流");
      }
      return fakeGenerator(buffer)(params);
    };
    const result = await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: flaky,
    });
    expect(result.failed.map((item) => item.specEntryId)).toEqual([
      "entry-001",
    ]);
    expect(result.created.map((page) => page.specEntryId)).toEqual([
      "entry-002",
    ]);
  });

  it("规格文件不合格时一个字节都不写：不留半成品 deck", async () => {
    const { parent, deckPath, buffer } = await setupDeck();
    const badSpec = join(parent, "bad-spec.json");
    // 页面文字含换行——展平后会被拆成两个候选，schema 层就该拒绝
    await writeFile(
      badSpec,
      JSON.stringify({
        ...buildSpec(),
        entries: [
          {
            ...entryAt(buildSpec(), 0),
            textGroups: [{ label: "标题", items: ["第一行\n第二行"] }],
          },
        ],
      }),
      "utf8",
    );

    await expect(
      runDeckGenerate({
        deckPath,
        specPath: badSpec,
        confirmUpload: true,
        generate: fakeGenerator(buffer),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // 读规格排在建 deck 之后的话，这里会留下一个空 deck 目录
    await expect(
      readFile(join(deckPath, "deck-manifest.json")),
    ).rejects.toThrow();
  });

  it("新建 deck 且一页都没建成时删掉半成品目录", async () => {
    const { deckPath, specPath } = await setupDeck();
    const alwaysFails: OpenAiImageGenerator = async () => {
      throw new Error("网关不可用");
    };
    const result = await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: alwaysFails,
    });
    expect(result.created).toEqual([]);
    expect(result.failed).toHaveLength(2);
    await expect(
      readFile(join(deckPath, "deck-manifest.json")),
    ).rejects.toThrow();
  });

  it("往既有 deck 追加时全部失败，绝不删掉既有页", async () => {
    const { deckPath, specPath, buffer } = await setupDeck();
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });
    const before = await readFile(
      join(deckPath, "slides/page-01/manifest.json"),
      "utf8",
    );

    // 追加一条新条目，但生成必失败
    const spec = buildSpec();
    const appended = await writeSpecFile(join(deckPath, ".."), {
      ...spec,
      entries: [
        ...spec.entries,
        {
          specEntryId: "entry-003",
          pageType: "summary",
          textGroups: [{ label: "结语", items: ["谢谢"] }],
          visualIntent: "居中单行",
          revisionNotes: [],
        },
      ],
    });
    const result = await runDeckGenerate({
      deckPath,
      specPath: appended,
      confirmUpload: true,
      generate: async () => {
        throw new Error("网关不可用");
      },
    });

    expect(result.created).toEqual([]);
    expect(result.failed.map((item) => item.specEntryId)).toEqual([
      "entry-003",
    ]);
    // 既有 deck 与既有页原封不动
    expect(
      await readFile(join(deckPath, "slides/page-01/manifest.json"), "utf8"),
    ).toBe(before);
  });

  it("缺少 --confirm-upload 时拒绝，且一个字节都不写", async () => {
    const { deckPath, specPath, buffer } = await setupDeck();
    await expect(
      runDeckGenerate({
        deckPath,
        specPath,
        confirmUpload: false,
        generate: fakeGenerator(buffer),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_CONFIRMATION_REQUIRED" });
    await expect(
      readFile(join(deckPath, "deck-manifest.json")),
    ).rejects.toThrow();
  });
});

/**
 * 目录内容快照：整张「相对路径 → sha256」映射整体比对。
 * 「一页都没建」要靠它证明——只比 deck-manifest.json 会漏掉半路建出的页目录。
 */
async function hashTree(root: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const absolute = join(entry.parentPath, entry.name);
    tree[relative(root, absolute)] = createHash("sha256")
      .update(await readFile(absolute))
      .digest("hex");
  }
  return tree;
}

function buildThreeEntrySpec(): ContentSpec {
  const spec = buildSpec();
  return {
    ...spec,
    entries: [
      entryAt(spec, 0),
      entryAt(spec, 1),
      {
        specEntryId: "entry-003",
        pageType: "summary",
        textGroups: [{ label: "结语", items: ["谢谢"] }],
        visualIntent: "居中单行",
        revisionNotes: [],
      },
    ],
  };
}

/** 计次生成器：按次计费的东西，断言「调了几次」比断言「建了几页」更贴近成本 */
function countingGenerator(buffer: Buffer): {
  generate: OpenAiImageGenerator;
  calls: () => number;
} {
  let calls = 0;
  const inner = fakeGenerator(buffer);
  return {
    generate: async (params) => {
      calls += 1;
      return inner(params);
    },
    calls: () => calls,
  };
}

describe("deck generate 的条目子集（entryIds）", () => {
  it("只建勾选的条目，其余落进 skipped，调用次数等于勾选数", async () => {
    const { deckPath, specPath, buffer } = await setupDeck(
      buildThreeEntrySpec(),
    );
    const counter = countingGenerator(buffer);
    const progress: { index: number; total: number }[] = [];

    const result = await runDeckGenerate({
      deckPath,
      specPath,
      entryIds: ["entry-001", "entry-003"],
      confirmUpload: true,
      generate: counter.generate,
      onProgress: (event) => {
        if (event.phase === "start") {
          progress.push({ index: event.index, total: event.total });
        }
      },
    });

    expect(result.created.map((page) => page.specEntryId)).toEqual([
      "entry-001",
      "entry-003",
    ]);
    // 页号按建页顺序递增，未选中的条目不占号
    expect(result.created.map((page) => page.pageLabel)).toEqual([
      "page-01",
      "page-02",
    ]);
    expect(result.skipped).toEqual(["entry-002"]);
    expect(counter.calls()).toBe(2);
    // 进度分母取过滤后的集合，否则界面上的「第 1/3 页」与实际执行次数对不上
    expect(progress).toEqual([
      { index: 1, total: 2 },
      { index: 2, total: 2 },
    ]);
    // 全量对账不受 entryIds 影响：调用方靠它知道这一轮之后还剩哪些条目待建
    expect(
      result.reconciliation.newEntries.map((entry) => entry.specEntryId),
    ).toEqual(["entry-001", "entry-002", "entry-003"]);
  });

  it("省略 entryIds 时建全部新增条目（默认路径不变）", async () => {
    const { deckPath, specPath, buffer } = await setupDeck(
      buildThreeEntrySpec(),
    );
    const counter = countingGenerator(buffer);

    const result = await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: counter.generate,
    });

    expect(result.created.map((page) => page.specEntryId)).toEqual([
      "entry-001",
      "entry-002",
      "entry-003",
    ]);
    expect(result.skipped).toEqual([]);
    expect(counter.calls()).toBe(3);
  });

  it("未知 id 整体拒绝：抛 SPEC_PAGE_NOT_FOUND 且一页都没建", async () => {
    const { deckPath, specPath, buffer } = await setupDeck(
      buildThreeEntrySpec(),
    );
    // 先建出前两页，留下 entry-003 待建：此后 deck 内已有权威规格，重跑不带 --spec
    await runDeckGenerate({
      deckPath,
      specPath,
      entryIds: ["entry-001", "entry-002"],
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });
    const before = await hashTree(deckPath);
    // 前置断言：快照必须真的装着那两页。`hashTree` 若哪天退化成返回空对象，
    // 下面的 `toEqual(before)` 会变成 `{}` 与 `{}` 相比——一条永远绿的空断言。
    expect(Object.keys(before).length).toBeGreaterThan(2);
    expect(
      Object.keys(before).filter((path) => path.startsWith("slides/page-02/"))
        .length,
    ).toBeGreaterThan(0);
    const counter = countingGenerator(buffer);

    await expect(
      runDeckGenerate({
        deckPath,
        // 合法 id 与未知 id 混在一起：合法的那条也不许建
        entryIds: ["entry-003", "entry-404"],
        confirmUpload: true,
        generate: counter.generate,
      }),
    ).rejects.toMatchObject({ code: "SPEC_PAGE_NOT_FOUND" });

    expect(counter.calls()).toBe(0);
    expect(await hashTree(deckPath)).toEqual(before);
  });

  it("未知 id 在建 deck 之前就判掉：不留半成品目录", async () => {
    const { deckPath, specPath, buffer } = await setupDeck(
      buildThreeEntrySpec(),
    );
    const counter = countingGenerator(buffer);

    await expect(
      runDeckGenerate({
        deckPath,
        specPath,
        entryIds: ["entry-404"],
        confirmUpload: true,
        generate: counter.generate,
      }),
    ).rejects.toMatchObject({ code: "SPEC_PAGE_NOT_FOUND" });

    expect(counter.calls()).toBe(0);
    await expect(
      readFile(join(deckPath, "deck-manifest.json")),
    ).rejects.toThrow();
  });

  it("--spec 打在既有 deck 上时未知 id 也不写盘：规格与变更日志都没动", async () => {
    // 「不留半成品目录」只守住了新建 deck 那一支。既有 deck 上 `--spec` 会走
    // `applySpecChange`——覆盖 deck 内权威规格并追加一条变更记录。校验若晚一步，
    // 目录还在、页也还在，但规格已经被换掉了，谁都看不出来。
    const { parent, deckPath, specPath, buffer } = await setupDeck();
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });
    const before = await hashTree(deckPath);
    expect(
      Object.keys(before).filter((path) => path.includes("content-spec"))
        .length,
    ).toBeGreaterThan(0);

    // 换一份**内容不同**的规格：校验一旦晚于 applySpecChange，磁盘必然出现 diff
    const nextSpecPath = await writeSpecFile(
      await mkdtemp(join(parent, "next-spec-")),
      buildSpec({ style: { description: "改过的风格：橙色主色、窄留白" } }),
    );
    const counter = countingGenerator(buffer);

    await expect(
      runDeckGenerate({
        deckPath,
        specPath: nextSpecPath,
        entryIds: ["entry-404"],
        confirmUpload: true,
        generate: counter.generate,
      }),
    ).rejects.toMatchObject({ code: "SPEC_PAGE_NOT_FOUND" });

    expect(counter.calls()).toBe(0);
    expect(await hashTree(deckPath)).toEqual(before);
  });

  it("已经建过页的 id 不算未知：不报错，落进 skipped", async () => {
    const { deckPath, specPath, buffer } = await setupDeck();
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(buffer),
    });
    const counter = countingGenerator(buffer);

    // 界面勾选来自可能稍旧的页面快照；「刚被别处建掉的条目」不该让整批失败
    const rerun = await runDeckGenerate({
      deckPath,
      entryIds: ["entry-001"],
      confirmUpload: true,
      generate: counter.generate,
    });

    expect(rerun.created).toEqual([]);
    expect(rerun.skipped).toEqual(["entry-001", "entry-002"]);
    expect(counter.calls()).toBe(0);
  });

  it("重复 id 只建一次：按次计费的东西不能因为传两遍就调两遍", async () => {
    const { deckPath, specPath, buffer } = await setupDeck(
      buildThreeEntrySpec(),
    );
    const counter = countingGenerator(buffer);

    // 现在靠「在 newEntries 上 filter」天然去重；若哪天改成在 entryIds 上 map 取条目，
    // 这里会当场变成两次生成调用（两页、两笔钱），而没有任何东西会报错。
    const result = await runDeckGenerate({
      deckPath,
      specPath,
      entryIds: ["entry-002", "entry-002"],
      confirmUpload: true,
      generate: counter.generate,
    });

    expect(counter.calls()).toBe(1);
    expect(result.created.map((page) => page.specEntryId)).toEqual([
      "entry-002",
    ]);
  });

  it("entryIds 为空数组时拒绝，且一个字节都不写", async () => {
    const { deckPath, specPath, buffer } = await setupDeck();
    await expect(
      runDeckGenerate({
        deckPath,
        specPath,
        entryIds: [],
        confirmUpload: true,
        generate: fakeGenerator(buffer),
      }),
    ).rejects.toMatchObject({ code: "SPEC_SELECTION_EMPTY" });
    await expect(
      readFile(join(deckPath, "deck-manifest.json")),
    ).rejects.toThrow();
  });
});

describe("提示词构造", () => {
  it("含风格段、每个分组与条目、视觉意图与全部调整说明及引导语", () => {
    const spec = buildSpec();
    const prompt = buildPageGenerationPrompt(spec.style, {
      ...entryAt(spec, 0),
      revisionNotes: ["标题再大一点", "配色改深蓝", "去掉底部渐变"],
    });
    expect(prompt).toContain("深蓝主色、无衬线中文、大留白");
    expect(prompt).toContain("标题: '全球营收概览'");
    expect(prompt).toContain("副标题: '2026 年度回顾'");
    expect(prompt).toContain("Visual intent: 居中大标题，底部渐变分隔线");
    expect(prompt).toContain("later ones take precedence");
    expect(prompt).toContain("1. 标题再大一点");
    expect(prompt).toContain("2. 配色改深蓝");
    expect(prompt).toContain("3. 去掉底部渐变");
  });
});
