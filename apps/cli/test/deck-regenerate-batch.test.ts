// `deck regenerate --pages / --all-drifted` 的批量语义与 A①-2 硬验收（M6 子任务① T6）。
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { ContentSpec, ContentSpecEntry } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { loadDeckContentSpec } from "../src/deck/content-spec.js";
import { runDeckGenerate } from "../src/deck/generate.js";
import {
  formatDeckRegenerateBatchResult,
  runDeckRegenerateBatch,
} from "../src/deck/regenerate-batch.js";
import type { OpenAiImageGenerator } from "../src/providers/openai-image.js";
import { runAcceptSource } from "../src/slide/accept-source.js";
import { runSlideOcr } from "../src/slide/ocr.js";
import { loadSlideWorkspace } from "../src/slide/workspace.js";
import {
  buildSpec,
  createFakeVisionBinary,
  entryAt,
  fakeGenerator,
  fakePageImage,
  writeSpecFile,
} from "./deck-generate-fixtures.js";

const PAGES = ["page-01", "page-02", "page-03"] as const;

function threeEntrySpec(): ContentSpec {
  const base = buildSpec();
  const third: ContentSpecEntry = {
    specEntryId: "entry-003",
    pageType: "content",
    textGroups: [{ label: "结语", items: ["持续投入研发"] }],
    visualIntent: "整页大字结语",
    revisionNotes: [],
  };
  return { ...base, entries: [...base.entries, third] };
}

/**
 * 页目录的**递归内容哈希映射**：相对路径 → 文件内容 sha256。
 *
 * A①-2 要的是「未勾选的页字节不变」，判据必须覆盖该目录下的**全部文件**
 * （manifest、config、资产、阶段产物、报告），并把整张映射整体比对——
 * 挑几个文件比会漏，只比 manifest 更会漏（资产改了 manifest 未必变）。
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

async function hashPages(
  deckPath: string,
  pages: readonly string[],
): Promise<Record<string, Record<string, string>>> {
  const snapshot: Record<string, Record<string, string>> = {};
  for (const page of pages) {
    snapshot[page] = await hashTree(join(deckPath, "slides", page));
  }
  return snapshot;
}

interface BatchDeck {
  readonly deckPath: string;
  readonly buffer: Buffer;
}

/** 三页全 generated 的 deck；每页都跑到 ocr，页目录里才有足够多的文件可比 */
async function setupThreePageDeck(
  spec: ContentSpec = threeEntrySpec(),
): Promise<BatchDeck> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-batch-"));
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
  for (const page of PAGES) {
    const workspacePath = join(deckPath, "slides", page);
    await runAcceptSource({ workspacePath, acceptedBy: "test" });
    await runSlideOcr({ workspacePath, binaryPath });
  }
  return { deckPath, buffer };
}

/** 直接改 deck 内权威规格（既有 C8 用例同款写法），制造「已过时」 */
async function writeDeckSpec(
  deckPath: string,
  spec: ContentSpec,
): Promise<void> {
  await writeFile(
    join(deckPath, "content-spec.json"),
    `${JSON.stringify(spec, null, 2)}\n`,
    "utf8",
  );
}

/** 把某条条目的文字换掉——文字变了，`reference_text` 必须跟着换代 */
function withChangedTexts(
  spec: ContentSpec,
  index: number,
  items: readonly string[],
): ContentSpec {
  return {
    ...spec,
    entries: spec.entries.map((entry, position) =>
      position === index
        ? {
            ...entry,
            textGroups: [{ label: "标题", items: [...items] }],
          }
        : entry,
    ),
  };
}

async function currentReferenceText(
  workspacePath: string,
): Promise<{ path: string; sha256: string; count: number; text: string }> {
  const workspace = await loadSlideWorkspace(workspacePath);
  const assets = workspace.manifest.assets.filter(
    (asset) => asset.role === "reference_text",
  );
  const current = assets.find(
    (asset) => asset.id === workspace.manifest.referenceTextAssetId,
  );
  if (current === undefined) {
    throw new Error("该页没有当前参考文案资产");
  }
  return {
    path: current.path,
    sha256: current.sha256,
    count: assets.length,
    text: await readFile(join(workspacePath, current.path), "utf8"),
  };
}

describe("批量重生成：未选中的页字节不变（A①-2 硬验收）", () => {
  it("三页 deck 只改一页规格，--all-drifted 只重出该页，另外两页目录逐字节不变", async () => {
    const spec = threeEntrySpec();
    const { deckPath, buffer } = await setupThreePageDeck(spec);

    const untouched = ["page-02", "page-03"];
    const before = await hashPages(deckPath, PAGES);
    // 前置断言：比对的确实是一整棵目录树，而不是一张空映射
    expect(Object.keys(before["page-02"] ?? {}).length).toBeGreaterThan(8);

    const referenceBefore = await currentReferenceText(
      join(deckPath, "slides/page-01"),
    );
    expect(referenceBefore.count).toBe(1);
    expect(referenceBefore.path).toBe("inputs/reference.txt");

    await writeDeckSpec(
      deckPath,
      withChangedTexts(spec, 0, ["全球营收总览", "较上年增长 18%"]),
    );

    const result = await runDeckRegenerateBatch({
      deckPath,
      selection: { kind: "all-drifted" },
      confirmUpload: true,
      generate: fakeGenerator(buffer, "req_batch_drifted"),
    });

    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.regenerated.map((page) => page.pageLabel)).toEqual([
      "page-01",
    ]);
    expect(result.regenerated[0]?.specEntryId).toBe("entry-001");

    const after = await hashPages(deckPath, PAGES);

    // ① 未选中的两页：整张哈希映射**整体相等**
    for (const page of untouched) {
      expect(after[page], `${page} 在批量重生成后必须逐字节不变`).toEqual(
        before[page],
      );
    }

    // ② 正向断言：被选中的那页确实变了（否则「什么都没做」也能让 ① 变绿）
    expect(after["page-01"]).not.toEqual(before["page-01"]);

    // ③ `referencePath` 通道没被绕过：新一代参考文案资产，sha 是新的、内容是新文字
    const referenceAfter = await currentReferenceText(
      join(deckPath, "slides/page-01"),
    );
    expect(referenceAfter.count).toBe(2);
    expect(referenceAfter.path).toBe("inputs/reference-2.txt");
    expect(referenceAfter.sha256).not.toBe(referenceBefore.sha256);
    expect(referenceAfter.text).toContain("全球营收总览");
    expect(referenceAfter.text).toContain("较上年增长 18%");
    expect(referenceBefore.text).not.toContain("全球营收总览");

    expect(formatDeckRegenerateBatchResult(result)).toContain(
      "重新生成 1 页，失败 0 页，跳过 0 页",
    );
  }, 180_000);
});

describe("批量选页语义", () => {
  it("--pages 有任一标签定位不到就整体拒绝，deck 一个字节都不动", async () => {
    const { deckPath } = await setupThreePageDeck();
    const before = await hashPages(deckPath, PAGES);

    await expect(
      runDeckRegenerateBatch({
        deckPath,
        selection: { kind: "labels", labels: ["page-01", "page-99"] },
        confirmUpload: true,
        generate: fakeGenerator(await fakePageImage(), "req_reject"),
      }),
    ).rejects.toMatchObject({
      code: "SPEC_PAGE_NOT_FOUND",
      message: expect.stringContaining("page-99"),
    });

    expect(await hashPages(deckPath, PAGES)).toEqual(before);
  }, 180_000);

  it("--pages 重复指定只重生成一次，且按 deck 页序执行", async () => {
    const { deckPath, buffer } = await setupThreePageDeck();

    const result = await runDeckRegenerateBatch({
      deckPath,
      selection: {
        kind: "labels",
        labels: ["page-03", "page-01", "page-03"],
      },
      confirmUpload: true,
      generate: fakeGenerator(buffer, "req_batch_labels"),
    });

    expect(result.regenerated.map((page) => page.pageLabel)).toEqual([
      "page-01",
      "page-03",
    ]);
    expect(result.skipped).toEqual([
      { pageLabel: "page-03", reason: "重复指定，只重生成一次" },
    ]);
    // page-02 从未被选中，仍是第一代
    const untouched = await loadSlideWorkspace(
      join(deckPath, "slides/page-02"),
    );
    expect(untouched.manifest.source.attemptId).toBe("init-001");
  }, 180_000);

  it("--all-drifted 一页都选不出时报 SPEC_SELECTION_EMPTY", async () => {
    const { deckPath } = await setupThreePageDeck();
    await expect(
      runDeckRegenerateBatch({
        deckPath,
        selection: { kind: "all-drifted" },
        confirmUpload: true,
        generate: fakeGenerator(await fakePageImage(), "req_empty"),
      }),
    ).rejects.toMatchObject({ code: "SPEC_SELECTION_EMPTY" });
  }, 180_000);

  it("缺少 --confirm-upload 时不选页、不出图、不写盘", async () => {
    const { deckPath } = await setupThreePageDeck();
    const before = await hashPages(deckPath, PAGES);
    await expect(
      runDeckRegenerateBatch({
        deckPath,
        selection: { kind: "labels", labels: ["page-01"] },
        confirmUpload: false,
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_CONFIRMATION_REQUIRED" });
    expect(await hashPages(deckPath, PAGES)).toEqual(before);
  }, 180_000);
});

describe("批量的失败口径", () => {
  it("单页失败不终止其余页，失败与成功各自入账", async () => {
    const spec = threeEntrySpec();
    const { deckPath, buffer } = await setupThreePageDeck(spec);

    // 两页同时过时：第一页的出图会失败，第二页必须照常跑完
    let drifted = withChangedTexts(spec, 0, ["注定失败的一页"]);
    drifted = withChangedTexts(drifted, 1, ["改好的要点"]);
    await writeDeckSpec(deckPath, drifted);

    const ok = fakeGenerator(buffer, "req_partial");
    const flaky: OpenAiImageGenerator = async (params) => {
      if (String(params.prompt).includes("注定失败的一页")) {
        throw new Error("网关 500");
      }
      return ok(params);
    };

    const result = await runDeckRegenerateBatch({
      deckPath,
      selection: { kind: "all-drifted" },
      confirmUpload: true,
      generate: flaky,
    });

    expect(result.failed).toEqual([
      { pageLabel: "page-01", code: "UNKNOWN_ERROR", message: "网关 500" },
    ]);
    expect(result.regenerated.map((page) => page.pageLabel)).toEqual([
      "page-02",
    ]);

    // 失败页的规格改动照样留在规格文件里（说明先落盘、图后出，与单页时序一致）
    const current = await loadDeckContentSpec(deckPath);
    expect(entryAt(current as ContentSpec, 0).textGroups[0]?.items).toEqual([
      "注定失败的一页",
    ]);

    const formatted = formatDeckRegenerateBatchResult(result);
    expect(formatted).toContain("重新生成 1 页，失败 1 页，跳过 0 页");
    expect(formatted).toContain("! page-01：UNKNOWN_ERROR 网关 500");
  }, 180_000);
});
