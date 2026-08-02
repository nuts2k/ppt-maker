import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runDeckGenerate } from "../src/deck/generate.js";
import { deckStatus, formatDeckStatus } from "../src/deck/status.js";
import { createDeckWorkspace } from "../src/deck/workspace.js";
import { formatSlideReport, runSlideReport } from "../src/report/run.js";
import { runAcceptSource } from "../src/slide/accept-source.js";
import { replaceSlideSource } from "../src/slide/replace-source.js";
import { loadSlideWorkspace } from "../src/slide/workspace.js";
import {
  buildSpec,
  fakeGenerator,
  fakePageImage,
  writeSpecFile,
} from "./deck-generate-fixtures.js";

/**
 * A10 后半：**报告能区分「人工确认」与「按来源自动放行」**。
 *
 * 磁盘层的区分一直是对的（自动放行不写 `accepted.json`），缺的是消费端——
 * 2026-08-02 阶段三走查实测 `deck status --json` 与 `report.json` 都没有任何字段
 * 表达这件事，只能靠「accepted.json 在不在」自己去翻目录。三处消费端逐一上锁。
 */

function pngFixture(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function createImportedDeck(pages: number): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-source-accept-"));
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

describe("deck status 区分人工确认与按来源自动放行（A10）", () => {
  it("导入页报自动放行，且磁盘上确实没有 accepted.json", async () => {
    const deckPath = await createImportedDeck(2);
    const status = await deckStatus(deckPath);

    expect(status.slides.map((slide) => slide.sourceAcceptance)).toEqual([
      "auto",
      "auto",
    ]);

    // 结构化字段与磁盘事实必须对得上：判据本身就是「这个文件在不在」
    for (const slide of status.slides) {
      expect(
        await pathExists(
          join(deckPath, slide.workspacePath, "stages/source/accepted.json"),
        ),
        `${slide.workspacePath} 不该有人工验收记录`,
      ).toBe(false);
    }

    const text = formatDeckStatus(status);
    expect(text).toContain("源图确认: 人工确认 0，按来源自动放行 2，待确认 0");
    // 自动放行不该被写成含糊的「已确认」——那等于把区分又抹掉一次
    expect(text).not.toContain("待确认源图:");
  });

  it("生成页：确认前报待确认并逐页点名，确认后报人工确认", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "ppt-maker-source-accept-gen-"),
    );
    const deckPath = join(parent, "deck");
    const specPath = await writeSpecFile(parent, buildSpec());
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(await fakePageImage()),
    });

    const before = await deckStatus(deckPath);
    expect(before.slides.map((slide) => slide.sourceAcceptance)).toEqual([
      "pending",
      "pending",
    ]);
    const beforeText = formatDeckStatus(before);
    expect(beforeText).toContain("待确认 2");
    // 「有 2 页待确认」而不说是哪两页，用户仍然无从下手
    expect(beforeText).toContain("待确认源图: page-01, page-02");

    await runAcceptSource({
      workspacePath: join(deckPath, "slides/page-01"),
      acceptedBy: "走查开发者",
    });

    const after = await deckStatus(deckPath);
    expect(after.slides.map((slide) => slide.sourceAcceptance)).toEqual([
      "manual",
      "pending",
    ]);
    expect(
      await pathExists(
        join(deckPath, "slides/page-01/stages/source/accepted.json"),
      ),
    ).toBe(true);
    expect(formatDeckStatus(after)).toContain(
      "源图确认: 人工确认 1，按来源自动放行 0，待确认 1",
    );
  }, 60_000);

  /**
   * 换源之后归档的旧验收记录不得冒充当前那份 —— 换源产生新一代产物，
   * 这类「文件确实在、哈希也对，错的是它描述的对象」正是本仓已实证过三次的形态。
   */
  it("生成页人工确认后换成导入图，报回自动放行且固定路径无 accepted.json", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "ppt-maker-source-accept-swap-"),
    );
    const deckPath = join(parent, "deck");
    const specPath = await writeSpecFile(parent, buildSpec());
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(await fakePageImage()),
    });
    const workspacePath = join(deckPath, "slides/page-01");
    await runAcceptSource({ workspacePath, acceptedBy: "走查开发者" });
    expect((await deckStatus(deckPath)).slides[0]?.sourceAcceptance).toBe(
      "manual",
    );

    const replaced = await replaceSlideSource({
      workspacePath,
      imagePath: pngFixture(),
    });
    expect(replaced.archivedSourceAcceptance, "旧验收记录必须被归档").toBe(
      true,
    );
    expect(replaced.requiresAcceptance).toBe(false);

    // **前置断言**：manifest 里确实有一条归档的 source_acceptance，
    // 否则这条用例可能什么都没覆盖（从没确认过的页天然也是 auto）
    const workspace = await loadSlideWorkspace(workspacePath);
    const acceptanceAssets = workspace.manifest.assets.filter(
      (asset) => asset.role === "source_acceptance",
    );
    expect(acceptanceAssets).toHaveLength(1);
    expect(acceptanceAssets[0]?.path).toBe(
      "stages/source/archived/init-002/accepted.json",
    );

    expect((await deckStatus(deckPath)).slides[0]?.sourceAcceptance).toBe(
      "auto",
    );
    expect(
      await pathExists(join(workspacePath, "stages/source/accepted.json")),
      "固定路径上不得残留旧图的人工验收记录",
    ).toBe(false);
  }, 60_000);
});

describe("slide report 正面陈述源图确认（A10 第三处消费端）", () => {
  it("自动放行页：report.source 明写 auto 且不留任何署名", async () => {
    const deckPath = await createImportedDeck(1);
    const { report } = await runSlideReport({
      workspacePath: join(deckPath, "slides/page-01"),
    });

    expect(report.source.kind).toBe("imported");
    expect(report.source.acceptance).toBe("auto");
    // 给系统署个名就是伪造人工痕迹（M4 头号风险）
    expect(report.source.acceptedBy).toBeNull();
    expect(report.source.acceptedAt).toBeNull();
    expect(formatSlideReport(report)).toContain(
      "来源：imported · 源图按来源自动放行",
    );
  }, 60_000);

  it("人工确认页：report.source 带真实签字人与时间", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-report-source-"));
    const deckPath = join(parent, "deck");
    const specPath = await writeSpecFile(parent, buildSpec());
    await runDeckGenerate({
      deckPath,
      specPath,
      confirmUpload: true,
      generate: fakeGenerator(await fakePageImage()),
    });
    const workspacePath = join(deckPath, "slides/page-01");

    const pending = await runSlideReport({ workspacePath });
    expect(pending.report.source.acceptance).toBe("pending");
    expect(pending.report.source.acceptedBy).toBeNull();

    await runAcceptSource({ workspacePath, acceptedBy: "走查开发者" });
    const { report } = await runSlideReport({ workspacePath });
    expect(report.source.kind).toBe("generated");
    expect(report.source.acceptance).toBe("manual");
    expect(report.source.acceptedBy).toBe("走查开发者");
    expect(report.source.acceptedAt).not.toBeNull();
    expect(formatSlideReport(report)).toContain("源图人工确认（走查开发者 于 ");
  }, 60_000);
});
