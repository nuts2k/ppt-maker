import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPptxProbe } from "../src/pptx.js";

describe("createPptxProbe", () => {
  it("生成非空的 PPTX zip 文件", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ppt-maker-pptx-"));
    const outputPath = join(directory, "probe.pptx");
    const imagePath = fileURLToPath(
      new URL("../../../fixtures/foundation/mixed-text.png", import.meta.url),
    );

    await createPptxProbe({ imagePath, outputPath });

    const fileStat = await stat(outputPath);
    const header = (await readFile(outputPath))
      .subarray(0, 2)
      .toString("ascii");
    expect(fileStat.size).toBeGreaterThan(1_000);
    expect(header).toBe("PK");
  });
});
