import { readdir, readFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-ignore — ESM/CJS 互操作
const { default: PptxGenJS } = await import("pptxgenjs");
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../../");
const WS_ROOT = resolve(PROJECT_ROOT, "artifacts/m2-workspaces");
const REVIEW_DIR = resolve(PROJECT_ROOT, "artifacts/m2-review");
const IMAGES_DIR = resolve(REVIEW_DIR, "source-images");

async function main() {
  await mkdir(IMAGES_DIR, { recursive: true });

  // 复制原始图片
  const pagesDir = resolve(PROJECT_ROOT, "artifacts/m2-pages");
  const pages = (await readdir(pagesDir))
    .filter((f) => f.endsWith(".png"))
    .sort();
  for (const f of pages) {
    await copyFile(resolve(pagesDir, f), resolve(IMAGES_DIR, f));
  }
  console.log(`已复制 ${pages.length} 张原始图片到 ${IMAGES_DIR}`);

  // 合并 PPTX
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  const dirs = (await readdir(WS_ROOT))
    .filter((d) => d.startsWith("page-"))
    .sort();

  for (const dir of dirs) {
    const pptxPath = resolve(WS_ROOT, dir, "stages/pptx/slide.pptx");
    try {
      const buf = await readFile(pptxPath);
      const zip = await JSZip.loadAsync(buf);

      const imgFile =
      zip.file("ppt/media/image-1-1.png") ?? zip.file("ppt/media/image1.png");
      if (!imgFile) {
        console.log(`${dir}: 无背景图，跳过`);
        continue;
      }
      const imgB64 = await imgFile.async("base64");

      const slide = pres.addSlide();
      slide.addImage({
        data: `image/png;base64,${imgB64}`,
        x: 0,
        y: 0,
        w: "100%",
        h: "100%",
      });

      const slideXml = await zip
        .file("ppt/slides/slide1.xml")
        ?.async("string");
      if (!slideXml) {
        console.log(`${dir}: 添加背景`);
        continue;
      }

      const spMatches = slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g);
      let textBoxCount = 0;
      for (const m of spMatches) {
        const sp = m[0];
        const offMatch = sp.match(/<a:off x="(\d+)" y="(\d+)"/);
        const extMatch = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
        if (!offMatch || !extMatch) continue;

        const x = Number.parseInt(offMatch[1]) / 914400;
        const y = Number.parseInt(offMatch[2]) / 914400;
        const w = Number.parseInt(extMatch[1]) / 914400;
        const h = Number.parseInt(extMatch[2]) / 914400;

        const textParts: string[] = [];
        const rMatches = sp.matchAll(/<a:r>[\s\S]*?<\/a:r>/g);
        for (const rm of rMatches) {
          const tMatch = rm[0].match(/<a:t>([\s\S]*?)<\/a:t>/);
          if (tMatch) textParts.push(tMatch[1]);
        }
        if (textParts.length === 0) continue;

        const szMatch = sp.match(/<a:rPr[^>]*sz="(\d+)"/);
        const fontSize = szMatch ? Number.parseInt(szMatch[1]) / 100 : 10;

        const clrMatch = sp.match(
          /<a:solidFill><a:srgbClr val="([0-9A-Fa-f]+)"/,
        );
        const color = clrMatch ? clrMatch[1] : "333333";

        const rotMatch = sp.match(/<a:xfrm rot="(-?\d+)"/);
        const rotate = rotMatch ? Number.parseInt(rotMatch[1]) / 60000 : 0;

        slide.addText(textParts.join(""), {
          x,
          y,
          w,
          h,
          fontSize,
          color,
          fontFace: "Microsoft YaHei",
          rotate,
        });
        textBoxCount++;
      }
      console.log(`${dir}: 背景 + ${textBoxCount} 个文本框`);
    } catch (e) {
      console.log(
        `${dir}: 跳过 (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  const outPath = resolve(REVIEW_DIR, "ppso-combined.pptx");
  await pres.writeFile({ fileName: outPath });
  console.log(`\n合并完成: ${outPath}`);
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
