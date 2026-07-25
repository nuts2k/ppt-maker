import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@cli": resolve(root, "../cli/src"),
      "@shared": resolve(root, "src/shared"),
      "@": resolve(root, "src/renderer"),
    },
  },
  test: {
    // CLI 业务函数按项目根目录解析原生 OCR 二进制（见 defaultVisionBinary）
    root,
    dir: resolve(root, "test"),
  },
});
