import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SlideSourceDraft } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { replaceDeckSlideSource } from "../src/deck/replace-source.js";
import { createDeckWorkspace } from "../src/deck/workspace.js";
import { runAcceptSource } from "../src/slide/accept-source.js";
import { replaceSlideSource } from "../src/slide/replace-source.js";
import {
  assertWorkspaceAssetIntegrity,
  createSlideWorkspace,
  loadSlideWorkspace,
  writeWorkspaceManifest,
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
  await writeWorkspaceManifest(workspacePath, manifest);
  return workspacePath;
}

const VALIDATION_PATH = "stages/review/validation.json";
const REVIEW_BODY = JSON.stringify({ blocks: [] });
const VALIDATION_BODY = JSON.stringify({ status: "passed" });

function reviewAsset(
  id: string,
  path: string,
  role: "text_review" | "review_validation",
  body: string,
  createdAt: string,
  producedBy: "review" | "assist-review",
  attemptId: string,
) {
  return {
    schemaVersion: 1 as const,
    id,
    path,
    role,
    sha256: createHash("sha256").update(body).digest("hex"),
    byteSize: body.length,
    createdAt,
    producedBy,
    attemptId,
    image: null,
  };
}

/**
 * 造一份贴近真实 deck 的页：`review` 与 `assist-review` 各写过一次复核稿，
 * manifest 里因此有**两条** `text_review` 指向同一个固定路径，另有一条校验报告。
 *
 * 复核报告刻意排在两条复核稿之前——归档中途失败时它已经搬走，回滚才有东西可回。
 */
async function createMultiReviewSlide(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-replace-multi-"));
  const workspacePath = join(parent, "slide");
  const created = await createSlideWorkspace({
    imagePath: pngFixture(),
    workspacePath,
  });

  await mkdir(join(workspacePath, "stages/review"), { recursive: true });
  await writeFile(join(workspacePath, REVIEW_PATH), REVIEW_BODY, "utf8");
  await writeFile(
    join(workspacePath, VALIDATION_PATH),
    VALIDATION_BODY,
    "utf8",
  );

  const at = created.manifest.createdAt;
  await writeWorkspaceManifest(workspacePath, {
    ...created.manifest,
    assets: [
      ...created.manifest.assets,
      reviewAsset(
        "asset-review-validation",
        VALIDATION_PATH,
        "review_validation",
        VALIDATION_BODY,
        at,
        "review",
        "review-001",
      ),
      reviewAsset(
        "asset-review-001-text-review",
        REVIEW_PATH,
        "text_review",
        REVIEW_BODY,
        at,
        "review",
        "review-001",
      ),
      reviewAsset(
        "asset-assist-review-004-text-review",
        REVIEW_PATH,
        "text_review",
        REVIEW_BODY,
        at,
        "assist-review",
        "assist-review-004",
      ),
    ],
    stages: created.manifest.stages.map((state) =>
      state.stage === "ocr" || state.stage === "review"
        ? { ...state, status: "completed" as const }
        : state,
    ),
  });
  return workspacePath;
}

async function assertNoDanglingAssets(workspacePath: string): Promise<void> {
  const { manifest } = await loadSlideWorkspace(workspacePath);
  for (const asset of manifest.assets) {
    expect(
      await exists(join(workspacePath, asset.path)),
      `资产 ${asset.id} 指向不存在的文件 ${asset.path}`,
    ).toBe(true);
    // 存在还不够：字节数与哈希也必须与 manifest 记录一致
    await assertWorkspaceAssetIntegrity(workspacePath, asset);
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

  it("多条复核资产指向同一路径时只搬一次，且全部改指归档路径", async () => {
    const workspacePath = await createMultiReviewSlide();

    const result = await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
    });

    expect(result.archivedReview).toBe(true);
    const archiveDir = `stages/review/archived/${result.attemptId}`;
    const { manifest } = await loadSlideWorkspace(workspacePath);
    const byId = (id: string) =>
      manifest.assets.find((asset) => asset.id === id);

    // review 与 assist-review 各写过一条，两条都要跟着搬走的文件走
    expect(byId("asset-review-001-text-review")?.path).toBe(
      `${archiveDir}/text-blocks.json`,
    );
    expect(byId("asset-assist-review-004-text-review")?.path).toBe(
      `${archiveDir}/text-blocks.json`,
    );
    // 校验报告用固定 id，沿用会被下一次 validate-review 覆盖，故换 id
    expect(byId("asset-review-validation")).toBeUndefined();
    expect(
      byId(`asset-review-validation-archived-${result.attemptId}`)?.path,
    ).toBe(`${archiveDir}/validation.json`);

    expect(await exists(join(workspacePath, REVIEW_PATH))).toBe(false);
    expect(await exists(join(workspacePath, VALIDATION_PATH))).toBe(false);
    await assertNoDanglingAssets(workspacePath);
  });

  it("归档中途失败时磁盘不残留半完成状态", async () => {
    const workspacePath = await createMultiReviewSlide();
    // 归档目标位置占成目录，rename(文件 → 目录) 必然 EISDIR。
    // 校验报告排在前面已经搬走，复核稿这一步才炸——正好检验回滚。
    await mkdir(join(workspacePath, "stages/review/archived/init-002"), {
      recursive: true,
    });
    await mkdir(
      join(workspacePath, "stages/review/archived/init-002/text-blocks.json"),
      { recursive: true },
    );
    const manifestBefore = await readFile(
      join(workspacePath, "manifest.json"),
      "utf8",
    );

    await expect(
      replaceSlideSource({ workspacePath, imagePath: jpgFixture() }),
    ).rejects.toThrow();

    // 已搬走的校验报告必须回到原处，否则 manifest 里的记录立刻悬空
    expect(await exists(join(workspacePath, VALIDATION_PATH))).toBe(true);
    expect(await exists(join(workspacePath, REVIEW_PATH))).toBe(true);
    expect(await readFile(join(workspacePath, "manifest.json"), "utf8")).toBe(
      manifestBefore,
    );
    await assertNoDanglingAssets(workspacePath);
  });

  it("manifest 写入失败时归档回滚，config 也写回旧源图", async () => {
    const workspacePath = await createMultiReviewSlide();
    const manifestBefore = await readFile(
      join(workspacePath, "manifest.json"),
      "utf8",
    );
    const { config: configBefore } = await loadSlideWorkspace(workspacePath);

    await expect(
      replaceSlideSource({
        workspacePath,
        imagePath: jpgFixture(),
        // 指纹不合法，落到 writeWorkspaceManifest 的 parse 才炸——此时文件已经搬走
        source: { ...GENERATED, specEntrySha256: "not-a-sha" },
      }),
    ).rejects.toThrow();

    expect(await exists(join(workspacePath, REVIEW_PATH))).toBe(true);
    expect(await exists(join(workspacePath, VALIDATION_PATH))).toBe(true);
    expect(await readFile(join(workspacePath, "manifest.json"), "utf8")).toBe(
      manifestBefore,
    );
    const { config } = await loadSlideWorkspace(workspacePath);
    expect(config.sourceImagePath).toBe(configBefore.sourceImagePath);
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

describe("换源与源图验收记录", () => {
  const ACCEPTED_PATH = "stages/source/accepted.json";

  /** 造一份「生成图 + 已人工确认源图」的页：磁盘上有 accepted.json */
  async function createAcceptedGeneratedSlide(): Promise<string> {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-replace-accept-"));
    const workspacePath = join(parent, "slide");
    await createSlideWorkspace({
      imagePath: pngFixture(),
      workspacePath,
      source: GENERATED,
    });
    await runAcceptSource({ workspacePath, acceptedBy: "tester" });
    expect(await exists(join(workspacePath, ACCEPTED_PATH))).toBe(true);
    return workspacePath;
  }

  it("换成导入图后旧的人工验收记录不再冒充当前验收", async () => {
    /*
     * 缺陷回归（2026-08-01 桌面端走查实证）：换源归档了复核成果却漏了 source_acceptance，
     * 于是一个自动放行的页磁盘上躺着对**上一张图**做的 accepted.json。
     * prd B5 的判据「自动放行不写 accepted.json，判据就是这个文件在不在」被直接打穿。
     */
    const workspacePath = await createAcceptedGeneratedSlide();

    const result = await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
    });

    expect(result.archivedSourceAcceptance).toBe(true);
    expect(result.requiresAcceptance).toBe(false);
    // 固定路径上没有文件 = 这页没有人工确认过，与「自动放行」的事实一致
    expect(await exists(join(workspacePath, ACCEPTED_PATH))).toBe(false);

    const { manifest } = await loadSlideWorkspace(workspacePath);
    const archivedPath = `stages/source/archived/${result.attemptId}/accepted.json`;
    expect(await exists(join(workspacePath, archivedPath))).toBe(true);
    // 固定 id 沿用会被下一次 accept-source 按 id 过滤掉，归档记录随即丢失，故换 id
    expect(
      manifest.assets.find((asset) => asset.id === "asset-source-acceptance"),
    ).toBeUndefined();
    expect(
      manifest.assets.find(
        (asset) =>
          asset.id === `asset-source-acceptance-archived-${result.attemptId}`,
      )?.path,
    ).toBe(archivedPath);

    // 本次放行是自动的，痕迹只在 attempt 上
    const gate = manifest.stages.find(
      (state) => state.stage === "accept-source",
    );
    expect(gate?.status).toBe("completed");
    expect(
      manifest.attempts.find(
        (entry) => entry.id === gate?.lastSuccessfulAttemptId,
      )?.provider,
    ).toBe("auto-source-trust");
    await assertNoDanglingAssets(workspacePath);
  });

  it("换成生成图后不存在可被误读为「已确认」的当前记录", async () => {
    const workspacePath = await createAcceptedGeneratedSlide();

    const result = await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
      source: GENERATED,
    });

    expect(result.requiresAcceptance).toBe(true);
    const { manifest } = await loadSlideWorkspace(workspacePath);
    expect(
      manifest.stages.find((state) => state.stage === "accept-source")?.status,
    ).not.toBe("completed");
    // 这才是最危险的一格：闸门未过、磁盘上却留着旧记录，等于对一张没人看过的图
    // 声称「已确认」
    expect(await exists(join(workspacePath, ACCEPTED_PATH))).toBe(false);
    await assertNoDanglingAssets(workspacePath);
  });

  it("--keep-review 保的是文字复核，源图验收记录照样归档", async () => {
    const workspacePath = await createAcceptedGeneratedSlide();
    await mkdir(join(workspacePath, "stages/review"), { recursive: true });
    await writeFile(join(workspacePath, REVIEW_PATH), REVIEW_BODY, "utf8");

    const result = await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
      keepReview: true,
    });

    // 那份判断对新图仍有参考价值，走 IoU 对齐；而「上一张图我看过了」对新图不成立
    expect(await exists(join(workspacePath, REVIEW_PATH))).toBe(true);
    expect(result.archivedSourceAcceptance).toBe(true);
    expect(await exists(join(workspacePath, ACCEPTED_PATH))).toBe(false);
    await assertNoDanglingAssets(workspacePath);
  });

  it("此前自动放行的页没有记录可归档", async () => {
    const workspacePath = await createReviewedSlide();

    const result = await replaceSlideSource({
      workspacePath,
      imagePath: jpgFixture(),
    });

    expect(result.archivedSourceAcceptance).toBe(false);
    await assertNoDanglingAssets(workspacePath);
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
