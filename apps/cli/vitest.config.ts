import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 默认 5000ms 对本包不够用。CLI 用例大量走真实链路：起 Node 子进程冒充原生
    // 二进制、用 sharp 处理真实 fixture PNG、逐阶段落库。常态下最慢的单个用例
    // 约 3.7s，余量不到 26%；`pnpm test` 三包并跑时会越过 5000ms，表现为
    // 随机某个用例 "Test timed out"——单跑必过，因而极易被误判为偶发。
    //
    // 抬到 30s 是给负载留余量，不是掩盖问题：真正挂死的用例仍会失败，只是晚 25 秒。
    // 复现方式：`npx vitest run --testTimeout=3000`，slide-review 那条会稳定超时。
    testTimeout: 30_000,
  },
});
