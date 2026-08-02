/**
 * `channels.ts` 是 renderer 与 main 的类型交界，**不得引用 `@cli/*`**。
 *
 * 为什么需要一条测试来守：`tsconfig.web.json` 的 `paths` 只有 `@/*` 与 `@shared/*`，
 * 而它的 `include` 覆盖 `src/renderer/**`，renderer 有十余处
 * `import type { … } from "../../main/ipc/channels.js"`，于是 channels.ts 会被拉进
 * web 项目一起类型检查。一个 `@cli` 导入就让 `pnpm -r typecheck` 在 renderer 项目下
 * 报「找不到模块」——而写代码的人在 main 项目里看什么都正常。
 *
 * 现状之所以一直没炸，只是因为 channels.ts 至今只引 `@ppt-maker/core` 与相对的
 * `shared/*`。这是一条**约定**，注释拦不住下一个人，所以落成静态断言。
 *
 * 用 `readFileSync` 而不是 shell 里的 grep：本机 `grep` 是 ugrep 别名，
 * `--include=*.ts` 会静默失效（不报错、不匹配、退出码 0），与「一条都没命中」
 * 完全无法区分（见 frontend/quality-guidelines.md）。读文件断言没有这个歧义。
 */

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** 匹配 `import … from "X"` / `export … from "X"` / `import("X")` 的模块说明符 */
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function specifiersOf(fileUrl: URL): string[] {
  const source = readFileSync(fileUrl, "utf8");
  return [...source.matchAll(SPECIFIER)].map((match) => match[1] as string);
}

const CHANNELS = new URL("../src/main/ipc/channels.ts", import.meta.url);
const SHARED_DIR = new URL("../src/shared/", import.meta.url);

describe("channels.ts 的类型交界约束", () => {
  it("不得从 @cli/* 导入任何东西", () => {
    const offenders = specifiersOf(CHANNELS).filter((specifier) =>
      specifier.startsWith("@cli"),
    );
    expect(
      offenders,
      "channels.ts 会被 renderer 项目一起类型检查，那里没有 @cli 路径映射；" +
        "跨层共享的类型请挪进 @ppt-maker/core",
    ).toEqual([]);
  });

  /**
   * 反向的半边：channels.ts 自己干净，但它相对导入的 `shared/*` 同样落在 web 项目的
   * `include` 里。约束只写在一个文件上，下一个人把 `@cli` 类型塞进 shared 再由
   * channels.ts 转出来，上面那条照样全绿。
   */
  it("src/shared/ 下同样不得出现 @cli/* 导入", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(SHARED_DIR)) {
      if (!name.endsWith(".ts")) {
        continue;
      }
      for (const specifier of specifiersOf(new URL(name, SHARED_DIR))) {
        if (specifier.startsWith("@cli")) {
          offenders.push(`${name} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /** 正对照：断言本身真的在扫文件，而不是对着空数组恒真 */
  it("解析器确实扫到了 channels.ts 的导入", () => {
    const specifiers = specifiersOf(CHANNELS);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers).toContain("@ppt-maker/core");
  });
});
