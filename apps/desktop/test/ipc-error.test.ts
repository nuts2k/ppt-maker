/**
 * IPC 错误文案剥壳。
 *
 * Electron 会把 main 抛出的错误重新包一层，走查里错误条上出现的整句是
 * `Error invoking remote method 'deck:source-task-start': FoundationError: 真正的原因`。
 * 这里锁住「只剥外壳、不动内容」，尤其是**剥不掉时必须原样返回**——
 * 为了好看而吞掉一段看不懂的文字，比多两层壳更糟。
 */

import { describe, expect, it } from "vitest";
import { ipcErrorMessage } from "../src/renderer/lib/ipc-error.js";

describe("ipcErrorMessage", () => {
  it("剥掉 invoke 外壳与一层错误类名", () => {
    expect(
      ipcErrorMessage(
        new Error(
          "Error invoking remote method 'deck:source-task-start': FoundationError: 页码范围非法：3--8",
        ),
      ),
    ).toBe("页码范围非法：3--8");
  });

  it("只剥一层类名：CLI 自己写进消息里的分类留着", () => {
    expect(
      ipcErrorMessage(
        new Error(
          "Error invoking remote method 'x': FoundationError: PdfError: 文件已加密",
        ),
      ),
    ).toBe("PdfError: 文件已加密");
  });

  it("没有外壳的消息原样返回", () => {
    expect(ipcErrorMessage(new Error("建页任务已在执行"))).toBe(
      "建页任务已在执行",
    );
  });

  it("非 Error 值也能给出文案", () => {
    expect(ipcErrorMessage("光秃秃一个字符串")).toBe("光秃秃一个字符串");
  });

  it("剥到空时把原文还回去，不给一片空白", () => {
    expect(
      ipcErrorMessage(new Error("Error invoking remote method 'deck:open': ")),
    ).toBe("Error invoking remote method 'deck:open': ");
  });
});
