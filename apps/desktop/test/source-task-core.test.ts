/**
 * 建页任务编排的时序回归（design §4.3 / RK-D）。
 *
 * 「新建 Deck」把 `deckPath` 变成可变维度，于是「请求发出 → 期间切换工作区 →
 * 迟到响应到达」从不可触发变成常规路径（.trellis/spec/frontend/state-management.md
 * 「新增一个切换维度的能力」）。守卫失效是**完全静默**的：界面看着正常，数据是上一个
 * 工作区的，所以只能靠复现完整时序的用例守住。
 *
 * 每处守卫都配一条**正对照**（不切换时结果必须照常写入），否则守卫写成恒真也能过。
 * 失败路径与成功路径各守一次：迟到的失败若照写 error，错误条会指着一个用户已经
 * 离开的工作区。
 */

import { describe, expect, it, vi } from "vitest";
import type {
  SourceTaskRequest,
  SourceTaskResult,
} from "../src/main/ipc/channels.js";
import {
  runSourceTask,
  type SourceTaskDeps,
  sourceTaskBlockedReason,
} from "../src/renderer/lib/source-task-core.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(err: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const REQUEST: SourceTaskRequest = {
  kind: "extract",
  pdfPath: "/tmp/deck.pdf",
};

function result(overrides: Partial<SourceTaskResult> = {}): SourceTaskResult {
  return {
    accepted: true,
    message: "建立 2 页，跳过 0 页",
    deckPath: "/decks/new",
    deckCreated: true,
    created: 2,
    failed: 0,
    skipped: 0,
    report: null,
    reportPath: null,
    regenerated: null,
    ...overrides,
  };
}

/**
 * 可控时序的依赖桩：`currentDeckPath` 读一个可变引用，用例在 await 之间改它，
 * 就复现了「响应还在半空时用户切了工作区」。
 */
function harness(origin: string | null): {
  deps: SourceTaskDeps;
  pending: Deferred<SourceTaskResult>;
  setDeckPath(next: string | null): void;
  onResult: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  refreshStatus: ReturnType<typeof vi.fn>;
  switchWorkspace: ReturnType<typeof vi.fn>;
  reloadActivity: ReturnType<typeof vi.fn>;
} {
  let deckPath = origin;
  const pending = deferred<SourceTaskResult>();
  const onResult = vi.fn();
  const onError = vi.fn();
  const refreshStatus = vi.fn(async () => undefined);
  const switchWorkspace = vi.fn(async () => undefined);
  const reloadActivity = vi.fn(async () => undefined);

  return {
    pending,
    onResult,
    onError,
    refreshStatus,
    switchWorkspace,
    reloadActivity,
    setDeckPath: (next) => {
      deckPath = next;
    },
    deps: {
      start: () => pending.promise,
      currentDeckPath: () => deckPath,
      refreshStatus,
      switchWorkspace,
      reloadActivity,
      onResult,
      onError,
    },
  };
}

describe("建页任务的竞态守卫", () => {
  it("正对照：不切换时成功结果照常写入，并切到新建出来的 deck", async () => {
    const h = harness(null);
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/new", createNew: true },
      REQUEST,
    );

    h.pending.resolve(result());
    const returned = await task;

    expect(returned).not.toBeNull();
    expect(h.onResult).toHaveBeenCalledTimes(1);
    expect(h.switchWorkspace).toHaveBeenCalledWith("/decks/new");
    expect(h.refreshStatus).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  /*
   * `switchWorkspace` 会把 deck 级会话态整体清零，`lastResult` 也在其中。结果若先于
   * 切换上报，就会被这次清零顺手抹掉——表现是批量生成建出新 deck 后，完成面板与它
   * 上面的「去确认」压根不出现（走查实测，design §5.4 的入口 2 整条失效）。
   */
  it("新建场景先切换、后上报结果，免得被切换时的清零抹掉", async () => {
    const h = harness(null);
    const order: string[] = [];
    h.switchWorkspace.mockImplementation(async () => {
      order.push("switch");
    });
    h.onResult.mockImplementation(() => {
      order.push("result");
    });

    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/new", createNew: true },
      REQUEST,
    );
    h.pending.resolve(result());
    await task;

    expect(order).toEqual(["switch", "result"]);
  });

  it("迟到的成功响应在切换工作区后被整条丢弃", async () => {
    const h = harness(null);
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/new", createNew: true },
      REQUEST,
    );

    // 响应还在半空时用户打开了另一个 deck
    h.setDeckPath("/decks/other");
    h.pending.resolve(result());

    expect(await task).toBeNull();
    expect(
      h.onResult,
      "迟到的结果不得写进另一个 deck 的界面",
    ).not.toHaveBeenCalled();
    expect(h.switchWorkspace).not.toHaveBeenCalled();
    expect(h.refreshStatus).not.toHaveBeenCalled();
  });

  it("正对照：不切换时失败照常报错", async () => {
    const h = harness("/decks/a");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/a", createNew: false },
      REQUEST,
    );

    h.pending.reject(new Error("PDF 已加密"));

    expect(await task).toBeNull();
    expect(h.onError).toHaveBeenCalledWith("PDF 已加密");
    expect(h.onResult).not.toHaveBeenCalled();
    expect(h.refreshStatus).not.toHaveBeenCalled();
  });

  /*
   * 走查实测：错误条上出现的是
   * `Error invoking remote method 'deck:source-task-start': FoundationError: PDF 中没有…`。
   * 领域错误（页码范围非法、PDF 里没有 16:9 页）本就该原样回显给用户（R3），
   * 前面挂两层壳等于把「照常显示原因」打了折。
   */
  it("错误条显示领域原因，不带 IPC 通道与类名外壳", async () => {
    const h = harness("/decks/a");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/a", createNew: false },
      REQUEST,
    );

    h.pending.reject(
      new Error(
        "Error invoking remote method 'deck:source-task-start': FoundationError: PDF 中没有可用于建立页面的 16:9 页：no-wide.pdf（跳过 2 页）",
      ),
    );
    await task;

    expect(h.onError).toHaveBeenCalledWith(
      "PDF 中没有可用于建立页面的 16:9 页：no-wide.pdf（跳过 2 页）",
    );
  });

  it("迟到的失败在切换工作区后不得写 error", async () => {
    const h = harness("/decks/a");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/a", createNew: false },
      REQUEST,
    );

    h.setDeckPath("/decks/b");
    h.pending.reject(new Error("PDF 已加密"));

    expect(await task).toBeNull();
    expect(
      h.onError,
      "错误条会指着一个用户已经离开的工作区",
    ).not.toHaveBeenCalled();
  });

  it("追加场景在原地刷新，不触发切换", async () => {
    const h = harness("/decks/a");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/a", createNew: false },
      REQUEST,
    );

    h.pending.resolve(result({ deckPath: "/decks/a", deckCreated: false }));
    await task;

    expect(h.refreshStatus).toHaveBeenCalledTimes(1);
    expect(h.switchWorkspace).not.toHaveBeenCalled();
  });

  /*
   * main 在任务收尾时写活动记录（抽取那条带着报告路径），追加场景不换 deckPath，
   * 没有任何 effect 会重载日志——不显式重拉的话，抽取报告一关就再也找不回来，
   * 而磁盘上那条记录一直在。失败路径同样写了记录，同样要跟上。
   */
  /*
   * 「新建」不保证换了 deck：落点是「来源文件同级 + 日期后缀」，同一天对同一份规格
   * 再点一次就落回同一个目录（CLI 照常对账跳过）。此时 `deckPath` 前后相同，
   * ConsolePage 那条按 deckPath 触发的 effect 不会重跑，而切换已经把日志清空了。
   */
  it("新建成功后同样重拉活动日志（落点可能就是当前 deck）", async () => {
    const h = harness("/decks/new");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/new", createNew: true },
      REQUEST,
    );

    h.pending.resolve(result({ deckPath: "/decks/new" }));
    await task;

    expect(h.switchWorkspace).toHaveBeenCalledTimes(1);
    expect(h.reloadActivity).toHaveBeenCalledTimes(1);
  });

  it("追加成功后重拉活动日志", async () => {
    const h = harness("/decks/a");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/a", createNew: false },
      REQUEST,
    );

    h.pending.resolve(result({ deckPath: "/decks/a", deckCreated: false }));
    await task;

    expect(h.reloadActivity).toHaveBeenCalledTimes(1);
  });

  it("失败后同样重拉活动日志", async () => {
    const h = harness("/decks/a");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/a", createNew: false },
      REQUEST,
    );

    h.pending.reject(new Error("PDF 已加密"));
    await task;

    expect(h.reloadActivity).toHaveBeenCalledTimes(1);
  });

  it("迟到的失败不重拉：那条记录属于用户已经离开的 deck", async () => {
    const h = harness("/decks/a");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/a", createNew: false },
      REQUEST,
    );

    h.setDeckPath("/decks/b");
    h.pending.reject(new Error("PDF 已加密"));
    await task;

    expect(h.reloadActivity).not.toHaveBeenCalled();
  });

  /**
   * 被互斥挡下**不是丢弃**：它要照常报给用户，只是不该刷新任何东西。
   * 两者都返回「什么都没发生」，混在一起就分不出「没跑」和「跑到别处去了」。
   */
  it("被互斥挡下时照常上报结果，但不刷新也不切换", async () => {
    const h = harness("/decks/a");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/a", createNew: false },
      REQUEST,
    );

    h.pending.resolve(
      result({ accepted: false, message: "流水线正在执行", deckPath: null }),
    );
    const returned = await task;

    expect(returned?.accepted).toBe(false);
    expect(h.onResult).toHaveBeenCalledTimes(1);
    expect(h.refreshStatus).not.toHaveBeenCalled();
    expect(h.switchWorkspace).not.toHaveBeenCalled();
    expect(h.reloadActivity, "没跑就没有记录可拉").not.toHaveBeenCalled();
  });

  /**
   * 新建时 `createNew` 为真但 CLI 没报出落点（理论上不该发生），此时不能拿
   * `null` 去切工作区——那会把用户从当前 deck 踢进空态。退回原地刷新。
   */
  it("新建但落点未知时退回刷新，不用 null 去切工作区", async () => {
    const h = harness("/decks/a");
    const task = runSourceTask(
      h.deps,
      { deckPath: "/decks/new", createNew: true },
      REQUEST,
    );

    h.pending.resolve(result({ deckPath: null }));
    await task;

    expect(h.switchWorkspace).not.toHaveBeenCalled();
    expect(h.refreshStatus).toHaveBeenCalledTimes(1);
  });
});

/**
 * 「被互斥挡下」的呈现判据（U12）。
 *
 * 走查实测：流水线执行中点「追加页面」，main 如实回了
 * `accepted: false` + 理由，界面却什么都没显示——完成面板与抽取报告只认
 * `accepted`，错误条只认抛出来的异常，`accepted: false` 落在两者的缝里没人管。
 * 用户看到的是「模态一关，什么都没发生」。
 */
describe("sourceTaskBlockedReason", () => {
  it("被挡下时给出 main 写的理由", () => {
    expect(
      sourceTaskBlockedReason(
        result({
          accepted: false,
          message: "流水线正在执行，请先停止后再新建页面（两者会同时写 deck）",
          deckPath: null,
        }),
      ),
    ).toBe("流水线正在执行，请先停止后再新建页面（两者会同时写 deck）");
  });

  it("成功的结果不算被挡下（那是完成面板的事）", () => {
    expect(sourceTaskBlockedReason(result())).toBeNull();
  });

  it("没有结果时不显示", () => {
    expect(sourceTaskBlockedReason(null)).toBeNull();
  });

  it("理由为空也要出一句话，不能静默", () => {
    expect(
      sourceTaskBlockedReason(result({ accepted: false, message: "" })),
    ).toBe("建页任务被挡下，未给出原因");
  });
});
