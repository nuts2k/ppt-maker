/**
 * 建页任务 store 的清零口径。
 *
 * 走查实测：换到另一个工作区后，上一个 deck 那句「PDF 中没有可用于建立页面的
 * 16:9 页」还挂在新 deck 顶上——`resetOtherStores` 当时清了 run / slide / activity /
 * ui 四个 store，唯独漏了 ④ 新增的这一个。
 *
 * 清零的边界是本文件真正要锁的东西：**错误条、完成面板、进度文字是 deck 级的，
 * `running` 是进程级的**。`running` 照的是 main 侧那个单例执行器，跟着一起清会让
 * 互斥的界面一半凭空放行，而 main 那边照样拒绝——用户点下去才发现不行。
 */

import { describe, expect, it } from "vitest";
import type { SourceTaskResult } from "../src/main/ipc/channels.js";
import { useSourceTaskStore } from "../src/renderer/stores/source-task-store.js";

const RESULT: SourceTaskResult = {
  accepted: true,
  message: "建立 2 页，跳过 0 页",
  deckPath: "/decks/a",
  deckCreated: false,
  created: 2,
  failed: 0,
  skipped: 0,
  report: null,
  reportPath: null,
  regenerated: null,
};

describe("useSourceTaskStore.reset", () => {
  it("清掉 deck 级的错误条、完成面板与进度文字", () => {
    useSourceTaskStore.setState({
      error: "PDF 中没有可用于建立页面的 16:9 页",
      lastResult: RESULT,
      kind: "extract",
      index: 3,
      total: 5,
      message: "正在抽取第 3 页",
    });

    useSourceTaskStore.getState().reset();

    const state = useSourceTaskStore.getState();
    expect(state.error).toBeNull();
    expect(state.lastResult).toBeNull();
    expect(state.kind).toBeNull();
    expect(state.index).toBe(0);
    expect(state.total).toBe(0);
    expect(state.message).toBe("");
  });

  /*
   * 完成面板的判据是 `kind === "generate" && lastResult`。两半由两次不同的写入
   * 产生，而新建场景中间夹着 `switchWorkspace` → 本 reset()，`kind` 会被清走。
   * 走查实测：批量生成建出新 deck 后完成面板与它上面的「去确认」整个不出现。
   * 这条锁住「清零确实会清掉 kind」，配合 store 里收尾时补写 kind 的那一步。
   */
  it("kind 属于 deck 级：清零会清掉它，因此收尾必须补写", () => {
    useSourceTaskStore.setState({ kind: "generate", lastResult: RESULT });

    useSourceTaskStore.getState().reset();

    expect(useSourceTaskStore.getState().kind).toBeNull();
  });

  it("不清 running：它照的是 main 侧的进程级执行器，不属于任何一个 deck", () => {
    useSourceTaskStore.setState({ running: true, error: "上一个 deck 的错误" });

    useSourceTaskStore.getState().reset();

    expect(useSourceTaskStore.getState().running).toBe(true);
    expect(useSourceTaskStore.getState().error).toBeNull();

    useSourceTaskStore.setState({ running: false });
  });
});
