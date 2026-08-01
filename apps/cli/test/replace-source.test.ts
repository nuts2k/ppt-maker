import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SlideSourceDraft } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { replaceDeckSlideSource } from "../src/deck/replace-source.js";
import { createDeckWorkspace } from "../src/deck/workspace.js";
import { replaceSlideSource } from "../src/slide/replace-source.js";
import {
  createSlideWorkspace,
  loadSlideWorkspace,
} from "../src/slide/workspace.js";

const HASH = "a".repeat(64);
const REVIEW_PATH = "stages/review/text-blocks.json";

const GENERATED: SlideSourceDraft = {
  kind: "generated",
  specEntryId: "entry-2",
  specEntrySha256: HASH,
  providerId: "openai",
  model: "gpt-image-2",
  promptVersion: "v1",
  promptSha256: HASH,
  parameters: {},
};

function pngFixture(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

function jpgFixture(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.jpg", import.meta.url),
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 造一份「已跑到复核」的页：有复核稿资产，且下游阶段已完成 */
async function createReviewedSlide(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-replace-"));
  const workspacePath = join(parent, "slide");
  const created = await createSlideWorkspace({
    imagePath: pngFixture(),
    workspacePath,
  });

  await mkdir(join(workspacePath, "stages/review"), { recursive: true });
  await writeFile(
    join(workspacePath, REVIEW_PATH),
    JSON.stringify({ blocks: [] }),
    "utf8",
  );
  const manifest = {
    ...created.manifest,
    assets: [
      ...created.manifest.assets,
      {
        schemaVersion: 1 as const,
        id: "asset-review-001-text-review",
        path: REVIEW_PATH,
        role: "text_review" as const,
        sha256: createHash("sha256")
          .update(JSON.stringify({ blocks: [] }))
          .digest("hex"),
        byteSize: JSON.stringify({ blocks: [] }).length,
        createdAt: created.manifest.createdAt,
        producedBy: "review" as const,
        attemptId: "review-001",
        image: null,
      },
    ],
    stages: created.manifest.stages.map((state) =>
      state.stage === "ocr" || state.stage === "review"
        ? { ...state, status: "completed" as const }
        : state,
    ),
  };
  const { writeWorkspaceManifest } = await import("../src/slide/workspace.js");
  await writeWorkspaceManifest(workspacePath, manifest);
  return workspacePath;
}

async function assertNoDanglingAssets(workspacePath: string): Promise<void> {
  const { manifest } = await loadSlideWorkspace(workspacePath);
  for (const asset of manifest.assets) {
    expect(
      await exists(join(workspacePath, asset.path)),
      `资产 ${asset.id} 指向不存在的文件 ${asset.path}`,
    ).toBe(true);
  }
}

describe("换源", () => {
  it("init 保持完成，源图确认及下游失效", async () => {
    const workspacePath = await createReviewedSlide();

    const result = await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
    });

    const { manifest, config } = await loadSlideWorkspace(workspacePath);
    const stage = (name: string) =>
      manifest.stages.find((state) => state.stage === name);

    // init 刚刚成功，标 stale 会与事实相反
    expect(stage("init")?.status).toBe("completed");
    expect(stage("init")?.lastSuccessfulAttemptId).toBe(result.attemptId);
    expect(stage("ocr")?.status).toBe("stale");
    expect(stage("review")?.status).toBe("stale");
    // 新图仍是导入来源，故确认闸门重新自动放行
    expect(stage("accept-source")?.status).toBe("completed");
    expect(result.requiresAcceptance).toBe(false);

    expect(config.sourceImagePath).toBe(result.sourceImagePath);
    expect(manifest.sourceImageAssetId).toBe(result.sourceAssetId);
    // 指纹必须随新图变化，否则下游复用判定认的还是旧图
    expect(stage("init")?.completedInputFingerprint).not.toBe(
      stage("ocr")?.completedInputFingerprint,
    );
  });

  it("默认归档复核稿：固定路径不再有文件，且无资产悬空", async () => {
    const workspacePath = await createReviewedSlide();

    const result = await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
    });

    expect(result.archivedReview).toBe(true);
    // readExistingReview 读固定路径，这里没有文件 → 人工块不被继承
    expect(await exists(join(workspacePath, REVIEW_PATH))).toBe(false);
    expect(
      await exists(
        join(
          workspacePath,
          `stages/review/archived/${result.attemptId}/text-blocks.json`,
        ),
      ),
    ).toBe(true);
    await assertNoDanglingAssets(workspacePath);
  });

  it("--keep-review 时复核稿留在原路径，走既有 IoU 对齐", async () => {
    const workspacePath = await createReviewedSlide();

    const result = await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
      keepReview: true,
    });

    expect(result.archivedReview).toBe(false);
    expect(await exists(join(workspacePath, REVIEW_PATH))).toBe(true);
    await assertNoDanglingAssets(workspacePath);
  });

  it("旧源图资产与文件保留，换源历史可查", async () => {
    const workspacePath = await createReviewedSlide();
    const before = await loadSlideWorkspace(workspacePath);
    const oldAssetId = before.manifest.sourceImageAssetId;

    await replaceSlideSource({ workspacePath, imagePath: jpgFixture() });

    const { manifest } = await loadSlideWorkspace(workspacePath);
    const old = manifest.assets.find((asset) => asset.id === oldAssetId);
    expect(old).toBeDefined();
    expect(await exists(join(workspacePath, old?.path ?? ""))).toBe(true);
    expect(manifest.attempts.filter((a) => a.stage === "init")).toHaveLength(2);
  });

  it("换成生成图时重新回到待确认", async () => {
    const workspacePath = await createReviewedSlide();

    const result = await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
      source: GENERATED,
    });

    expect(result.requiresAcceptance).toBe(true);
    const { manifest } = await loadSlideWorkspace(workspacePath);
    expect(manifest.source.kind).toBe("generated");
    expect(
      manifest.stages.find((state) => state.stage === "accept-source")?.status,
    ).not.toBe("completed");
    // 自动放行的 attempt 不该在这条路径上产生
    expect(
      manifest.attempts.filter((a) => a.provider === "auto-source-trust"),
    ).toHaveLength(1);
  });

  it("反向换回导入图时自动放行", async () => {
    const workspacePath = await createReviewedSlide();
    await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
      source: GENERATED,
    });

    const back = await replaceSlideSource({
      workspacePath,
      imagePath: pngFixture(),
    });

    expect(back.requiresAcceptance).toBe(false);
    const { manifest } = await loadSlideWorkspace(workspacePath);
    expect(
      manifest.stages.find((state) => state.stage === "accept-source")?.status,
    ).toBe("completed");
  });
});

describe("deck 层换源", () => {
  it("只影响目标页，其它页 manifest 逐字节不变", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-replace-"));
    const imagesDir = join(parent, "images");
    await mkdir(imagesDir, { recursive: true });
    await writeFile(join(imagesDir, "a.png"), await readFile(pngFixture()));
    await writeFile(join(imagesDir, "b.png"), await readFile(pngFixture()));
    const deckPath = join(parent, "deck");
    await createDeckWorkspace({ imagesDir, workspacePath: deckPath });

    const otherManifest = join(deckPath, "slides/page-02/manifest.json");
    const before = await readFile(otherManifest, "utf8");

    const result = await replaceDeckSlideSource({
      deckPath,
      page: "page-01",
      imagePath: jpgFixture(),
    });

    expect(result.workspacePath).toBe("slides/page-01");
    expect(await readFile(otherManifest, "utf8")).toBe(before);

    const deckManifest = JSON.parse(
      await readFile(join(deckPath, "deck-manifest.json"), "utf8"),
    ) as { slides: { workspacePath: string; sourceImageName: string }[] };
    expect(
      deckManifest.slides.find((s) => s.workspacePath === "slides/page-01")
        ?.sourceImageName,
    ).toBe("mixed-text.jpg");
  });

  it("页面标识不存在时报错而不是静默无操作", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-replace-"));
    const imagesDir = join(parent, "images");
    await mkdir(imagesDir, { recursive: true });
    await writeFile(join(imagesDir, "a.png"), await readFile(pngFixture()));
    const deckPath = join(parent, "deck");
    await createDeckWorkspace({ imagesDir, workspacePath: deckPath });

    await expect(
      replaceDeckSlideSource({
        deckPath,
        page: "page-99",
        imagePath: jpgFixture(),
      }),
    ).rejects.toThrow("找不到页面");
  });
});
