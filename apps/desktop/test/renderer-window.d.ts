/**
 * test 侧的 renderer 全局 `window` 声明。
 *
 * test 走 tsconfig.node.json（lib 仅 ES2023、无 DOM），而 deck / slide / activity
 * 三个 store 经 `window.api` 访问 IPC——不声明就没法把它们拉进 test 的类型图，
 * 「迟到响应不得写入 store」这类时序回归也就无从断言。
 *
 * 形状按 preload 实际注入的写死成 `{ api: IpcApi }`（与 renderer/env.d.ts 一致），
 * 不引 DOM lib：main 进程若误用 `window.document` 之类仍会照常报错。
 * 运行期由各测试用 `globalThis.window = { api: ... }` 打桩。
 */

import type { IpcApi } from "../src/main/ipc/channels.js";

declare global {
  // 全局变量声明只能用 var
  var window: { api: IpcApi };
}
