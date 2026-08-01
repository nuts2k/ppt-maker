import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SlideStage } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { deckStatus, formatDeckStatus } from "../src/deck/status.js";
import { createDeckWorkspace } from "../src/deck/workspace.js";
import { replaceSlideSource } from "../src/slide/replace-source.js";
import {
  loadSlideWorkspace,
  writeWorkspaceManifest,
} from "../src/slide/workspace.js";

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

async function createDeck(pages: number): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-deck-status-"));
  const imagesDir = join(parent, "images");
  await mkdir(imagesDir, { recursive: true });
  const image = await readFile(pngFixture());
  for (let index = 0; index < pages; index += 1) {
    await writeFile(join(imagesDir, `${String(index)}.png`), image);
  }
  const deckPath = join(parent, "deck");
  await createDeckWorkspace({ imagesDir, workspacePath: deckPath });
  return deckPath;
}

/** 把该页指定阶段改成给定状态，其余保持原样 */
async function setStages(
  deckPath: string,
  page: string,
  statuses: Partial<Record<SlideStage, "completed" | "failed">>,
): Promise<void> {
  const workspacePath = join(deckPath, "slides", page);
  const { manifest } = await loadSlideWorkspace(workspacePath);
  await writeWorkspaceManifest(workspacePath, {
    ...manifest,
    stages: manifest.stages.map((state) => {
      const next = statuses[state.stage];
      return next === undefined ? state : { ...state, status: next };
    }),
  });
}

const ALL_AFTER_SOURCE: SlideStage[] = [
  "ocr",
  "review",
  "assist-review",
  "mask",
  "clean",
  "accept-clean",
  "pptx",
  "accept-pptx",
  "report",
];

function slideOf(result: Awaited<ReturnType<typeof deckStatus>>, page: string) {
  const slide = result.slides.find((entry) =>
    entry.workspacePath.endsWith(page),
  );
  expect(slide, `找不到 ${page}`).toBeDefined();
  return slide;
}

describe("deck status 指名卡住的阶段", () => {
  it("换源后报 ocr，而不是那个已完成的 accept-source", async () => {
    const deckPath = await createDeck(2);
    await setStages(
      deckPath,
      "page-01",
      Object.fromEntries(ALL_AFTER_SOURCE.map((stage) => [stage, "completed"])),
    );
    await replaceSlideSource({
      workspacePath: join(deckPath, "slides/page-01"),
      imagePath: jpgFixture(),
    });

    const result = await deckStatus(deckPath);
    const slide = slideOf(result, "page-01");

    // 换源后 init 与 accept-source 都 completed、ocr 起全部 stale。
    // 「最后一个已完成阶段」正是 accept-source，旧口径会指着它报失败。
    expect(slide?.currentStage).toBe("accept-source");
    expect(slide?.blockingStage).toBe("ocr");
    expect(slide?.stageStatus).toBe("stale");

    const text = formatDeckStatus(result);
    expect(text).toContain("失败: page-01 (ocr)");
    expect(text).not.toContain("accept-source");

    // 跑过 OCR 又被换源作废的页有历史产出，只是当前无可用产出——不是「未开始」。
    // 按 currentStage 的位置判断会把它算成未开始：换源让闸门之后全部转 stale，
    // 最后一个已完成阶段退回 accept-source。
    expect(slide?.started).toBe(true);
    expect(result.summary.notStarted).toBe(1); // 只有没动过的 page-02
    expect(result.summary.inProgress).toBe(1);
  });

  it("中段失败仍指名失败的那个阶段", async () => {
    const deckPath = await createDeck(1);
    await setStages(deckPath, "page-01", {
      ocr: "completed",
      review: "completed",
      "assist-review": "completed",
      mask: "failed",
    });

    const result = await deckStatus(deckPath);
    const slide = slideOf(result, "page-01");

    expect(slide?.currentStage).toBe("assist-review");
    expect(slide?.blockingStage).toBe("mask");
    expect(slide?.stageStatus).toBe("failed");
    expect(formatDeckStatus(result)).toContain("失败: page-01 (mask)");
  });

  it("没有阻塞阶段时按进度报进行中", async () => {
    const deckPath = await createDeck(1);
    await setStages(deckPath, "page-01", {
      ocr: "completed",
      review: "completed",
    });

    const result = await deckStatus(deckPath);
    const slide = slideOf(result, "page-01");

    expect(slide?.blockingStage).toBeNull();
    expect(slide?.currentStage).toBe("review");
    const text = formatDeckStatus(result);
    expect(text).toContain("进行中: page-01 (review)");
    expect(text).not.toContain("失败");
  });

  it("刚建好的页算未开始，既不进进行中也不进失败", async () => {
    const deckPath = await createDeck(1);

    const result = await deckStatus(deckPath);
    const slide = slideOf(result, "page-01");

    // accept-source 自动放行后 currentStage 已经不是 init 了，但这页一步没跑，
    // 仍属未开始——判据是「闸门之后有没有阶段脱离 pending」
    expect(slide?.currentStage).toBe("accept-source");
    expect(slide?.started).toBe(false);
    expect(slide?.blockingStage).toBeNull();
    expect(result.summary.notStarted).toBe(1);
    expect(result.summary.inProgress).toBe(0);
    const text = formatDeckStatus(result);
    expect(text).not.toContain("失败");
    expect(text).not.toContain("进行中");
  });

  it("已验收的页被上游作废时不因进度靠后而被跳过", async () => {
    const deckPath = await createDeck(1);
    await setStages(
      deckPath,
      "page-01",
      Object.fromEntries(ALL_AFTER_SOURCE.map((stage) => [stage, "completed"])),
    );
    // 只作废 report：进度停在 accept-pptx，旧实现按「已跑完」把整页跳过，
    // 于是一页需要重跑的 deck 看上去毫无问题
    const workspacePath = join(deckPath, "slides/page-01");
    const { manifest } = await loadSlideWorkspace(workspacePath);
    await writeWorkspaceManifest(workspacePath, {
      ...manifest,
      stages: manifest.stages.map((state) =>
        state.stage === "report"
          ? {
              ...state,
              status: "stale" as const,
              invalidatedAt: "2026-08-01T00:00:00.000Z",
              invalidationReason: "人工要求重跑",
            }
          : state,
      ),
    });

    const result = await deckStatus(deckPath);
    expect(slideOf(result, "page-01")?.blockingStage).toBe("report");
    expect(formatDeckStatus(result)).toContain("失败: page-01 (report)");
  });

  it("已移除的页不参与阻塞判定", async () => {
    const deckPath = await createDeck(1);
    const result = await deckStatus(deckPath);
    for (const slide of result.slides) {
      if (slide.removed) {
        expect(slide.blockingStage).toBeNull();
      }
    }
    expect(result.summary.total).toBe(1);
  });
});
