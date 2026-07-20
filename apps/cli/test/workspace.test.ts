import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SlideWorkspaceConfigSchema,
  SlideWorkspaceManifestSchema,
} from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  assertWorkspaceAssetIntegrity,
  createSlideWorkspace,
  loadSlideWorkspace,
} from "../src/slide/workspace.js";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
  );
}

describe("slide workspace", () => {
  it("原子创建包含输入、配置和阶段状态的工作区", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-workspace-"));
    const workspacePath = join(parent, "slide-1");
    const referencePath = join(parent, "reference.txt");
    await writeFile(referencePath, "候选文案\n", "utf8");

    const created = await createSlideWorkspace({
      imagePath: fixturePath(),
      workspacePath,
      referencePath,
    });
    const manifest = SlideWorkspaceManifestSchema.parse(
      JSON.parse(await readFile(join(workspacePath, "manifest.json"), "utf8")),
    );
    const config = SlideWorkspaceConfigSchema.parse(
      JSON.parse(await readFile(join(workspacePath, "config.json"), "utf8")),
    );

    expect(created.path).toBe(workspacePath);
    expect(config.sourceImagePath).toBe("inputs/source.png");
    expect(config.referenceTextPath).toBe("inputs/reference.txt");
    expect(manifest.assets).toHaveLength(2);
    expect(
      manifest.stages.find((stage) => stage.stage === "init")?.status,
    ).toBe("completed");
    expect(manifest.stages.find((stage) => stage.stage === "ocr")?.status).toBe(
      "pending",
    );

    const loaded = await loadSlideWorkspace(workspacePath);
    for (const asset of loaded.manifest.assets) {
      await expect(
        assertWorkspaceAssetIntegrity(workspacePath, asset),
      ).resolves.toBeUndefined();
    }
  });

  it("拒绝非 16:9 输入且不创建目标工作区", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-workspace-"));
    const imagePath = join(parent, "one.png");
    const workspacePath = join(parent, "slide-invalid");
    await writeFile(imagePath, ONE_BY_ONE_PNG);

    await expect(
      createSlideWorkspace({ imagePath, workspacePath }),
    ).rejects.toThrow("16:9");
    await expect(
      readFile(join(workspacePath, "manifest.json")),
    ).rejects.toThrow();
  });

  it("拒绝覆盖已有工作区", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-workspace-"));
    const workspacePath = join(parent, "slide-existing");
    await createSlideWorkspace({ imagePath: fixturePath(), workspacePath });

    await expect(
      createSlideWorkspace({ imagePath: fixturePath(), workspacePath }),
    ).rejects.toThrow("拒绝覆盖");
  });

  it("拒绝把空目录替换为工作区", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-workspace-"));
    const workspacePath = join(parent, "empty-existing");
    await mkdir(workspacePath);

    await expect(
      createSlideWorkspace({ imagePath: fixturePath(), workspacePath }),
    ).rejects.toThrow("拒绝覆盖");
  });

  it("检测工作区资产被外部修改", async () => {
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-workspace-"));
    const workspacePath = join(parent, "slide-tampered");
    const created = await createSlideWorkspace({
      imagePath: fixturePath(),
      workspacePath,
    });
    const source = created.manifest.assets[0];
    expect(source).toBeDefined();
    if (source === undefined) {
      return;
    }
    await writeFile(join(workspacePath, source.path), "tampered", "utf8");

    await expect(
      assertWorkspaceAssetIntegrity(workspacePath, source),
    ).rejects.toThrow("完整性校验失败");
  });
});
