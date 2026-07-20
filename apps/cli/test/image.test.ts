import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readImageMetadata } from "../src/image.js";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("readImageMetadata", () => {
  it("读取 PNG 尺寸并返回比例校验", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ppt-maker-image-"));
    const path = join(directory, "one.png");
    await writeFile(path, ONE_BY_ONE_PNG);

    const metadata = await readImageMetadata(path);
    expect(metadata.type).toBe("png");
    expect(metadata.width).toBe(1);
    expect(metadata.height).toBe(1);
    expect(metadata.aspectRatio.valid).toBe(false);
  });

  it("读取受控 JPEG fixture", async () => {
    const path = fileURLToPath(
      new URL("../../../fixtures/foundation/mixed-text.jpg", import.meta.url),
    );
    const metadata = await readImageMetadata(path);

    expect(metadata.type).toBe("jpg");
    expect(metadata.width).toBe(1600);
    expect(metadata.height).toBe(900);
    expect(metadata.aspectRatio.valid).toBe(true);
  });
});
