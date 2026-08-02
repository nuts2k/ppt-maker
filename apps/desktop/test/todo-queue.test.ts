import { describe, expect, it } from "vitest";
import type {
  SlideDetail,
  SlideLastError,
  SlideStageDetail,
} from "../src/main/ipc/channels.js";
import type { SessionRunResult } from "../src/renderer/stores/run-types.js";
import {
  deriveTodoQueue,
  flattenTodoQueue,
  nextTodoItem,
} from "../src/renderer/stores/todo-queue.js";
import { RUN_STAGE_SEQUENCE, type RunStage } from "../src/shared/stages.js";

interface SlideFixture {
  readonly pageLabel: string;
  /** deckStatus 给出的当前阶段状态，默认 completed */
  readonly stageStatus?: string;
  readonly currentStage?: string;
  readonly removed?: boolean;
  /** 标记为 completed 的执行阶段，其余为 pending */
  readonly completed?: readonly RunStage[];
  /** 逐阶段覆盖状态（如失效链），优先于 `completed` */
  readonly stageStatuses?: Readonly<
    Partial<Record<RunStage, SlideStageDetail["status"]>>
  >;
  readonly lastError?: SlideLastError;
  /** 待人工复核的版式文字块数，默认 0 */
  readonly pendingTextReview?: number;
  /** 页面来源，默认 imported */
  readonly sourceKind?: SlideDetail["sourceKind"];
  /** 规格漂移，默认 null（不适用） */
  readonly specDrift?: SlideDetail["specDrift"];
}

function makeSlide(fixture: SlideFixture): SlideDetail {
  const completed = new Set<string>(fixture.completed ?? []);
  const stages: SlideStageDetail[] = RUN_STAGE_SEQUENCE.map((stage) => ({
    stage,
    status:
      fixture.stageStatuses?.[stage] ??
      (completed.has(stage) ? "completed" : "pending"),
  }));
  return {
    slideId: `slide-${fixture.pageLabel}`,
    workspacePath: `slides/${fixture.pageLabel}`,
    absWorkspacePath: `/decks/demo/slides/${fixture.pageLabel}`,
    pageLabel: fixture.pageLabel,
    sourceImageName: `${fixture.pageLabel}.png`,
    currentStage: fixture.currentStage ?? "report",
    stageStatus: fixture.stageStatus ?? "completed",
    removed: fixture.removed ?? false,
    sourceKind: fixture.sourceKind ?? "imported",
    specEntryId: fixture.sourceKind === "generated" ? "entry-001" : null,
    specDrift: fixture.specDrift ?? null,
    stages,
    lastError: fixture.lastError ?? null,
    stageDurations: {},
    pendingTextReview: fixture.pendingTextReview ?? 0,
  };
}

function sessionResult(slideId: string, gate: string | null): SessionRunResult {
  const stoppedAt =
    gate === "validation-failed"
      ? "validate-review"
      : gate === "human-edit"
        ? "review"
        : gate === "source"
          ? "accept-source"
          : null;
  return {
    slideId,
    gate,
    stoppedAt,
    message: "停在闸门",
    error: null,
  };
}

/** 跑完全流程的页（所有执行阶段 completed） */
const ALL_DONE = RUN_STAGE_SEQUENCE;
/**
 * 源图已确认。
 *
 * 凡是跑过 ocr 的页都必然满足它：`accept-source` 是 ocr 的前置依赖，导入页在建立
 * 工作区时就自动放行为 completed。夹具里不列它，等于造出一个真实链路里不存在的
 * 「源图没确认却已经跑到 pptx」的页。
 */
const SOURCE_CONFIRMED: RunStage[] = ["accept-source"];
/** 复核稿已生成 */
const THROUGH_REVIEW: RunStage[] = [
  ...SOURCE_CONFIRMED,
  "ocr",
  "review",
  "assist-review",
];
/** 跑到 clean 完成（收敛后 accept-clean 不再单独停顿） */
const THROUGH_CLEAN: RunStage[] = [
  ...THROUGH_REVIEW,
  "validate-review",
  "mask",
  "clean",
];
/** 跑到 pptx 完成、等待最终确认 */
const THROUGH_PPTX: RunStage[] = [...THROUGH_CLEAN, "pptx"];

/*
 * 2026-08-01 真机走查暴露的缺口：生成图停在源图确认后，队列与「待处理」筛选里
 * 都没有这一页——`gate: "source"` 落在会话层，而 deriveSlideItem 只认
 * validation-failed 与 human-edit 两个 gate。刷新之后连会话层也没了，这页被
 * 归入「未开始」，界面上再没有任何线索。
 */
describe("deriveTodoQueue 待确认源图组", () => {
  it("accept-source 未完成即入队，无需任何会话结果（刷新后仍在）", () => {
    const queue = deriveTodoQueue(
      [makeSlide({ pageLabel: "page-02", currentStage: "init" })],
      {},
    );

    expect(queue.total).toBe(1);
    expect(queue.groups[0]?.group).toBe("confirm-source");
    expect(queue.groups[0]?.label).toBe("待确认源图");
    expect(queue.groups[0]?.items[0]).toMatchObject({
      pageLabel: "page-02",
      reason: "源图待人工确认，确认后链路才会继续",
      stage: "accept-source",
    });
  });

  it("自动放行的导入页不入队（accept-source 建立工作区时即 completed）", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "accept-source",
          completed: SOURCE_CONFIRMED,
        }),
      ],
      {},
    );

    expect(queue.total).toBe(0);
  });

  /** 判据必须取耐久层：会话层的 source 闸门管不了刷新，也不该反过来盖住耐久事实 */
  it("accept-source 已完成时，残留的 source 会话闸门不足以让它重新入队", () => {
    const slide = makeSlide({
      pageLabel: "page-01",
      currentStage: "accept-source",
      completed: SOURCE_CONFIRMED,
    });
    const queue = deriveTodoQueue([slide], {
      [slide.slideId]: sessionResult(slide.slideId, "source"),
    });

    expect(queue.total).toBe(0);
  });

  /** 显式失效源图确认（阶段轨道上重跑该节点）同样是欠着的人工确认 */
  it("accept-source 被置为 stale 时仍算欠一次确认", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-02",
          currentStage: "init",
          stageStatuses: { "accept-source": "stale" },
        }),
      ],
      {},
    );

    expect(queue.groups[0]?.group).toBe("confirm-source");
  });

  it("失败态仍然优先（failed 居首是既定约定，源图确认不抢它）", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-02",
          currentStage: "init",
          stageStatus: "failed",
          lastError: {
            stage: "init",
            code: "INVALID_ASPECT_RATIO",
            message: "源图不是 16:9",
            at: "2026-08-01T00:00:00.000Z",
          },
        }),
      ],
      {},
    );

    expect(queue.groups[0]?.group).toBe("failed");
  });
});

describe("deriveTodoQueue 四组判定", () => {
  it("耐久层 failed 归入失败组，原因取 lastError 的 code + message", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "mask",
          stageStatus: "failed",
          completed: THROUGH_REVIEW,
          lastError: {
            stage: "mask",
            code: "MASK_FAILED",
            message: "遮罩生成失败",
            at: "2026-07-01T00:00:00.000Z",
          },
        }),
      ],
      {},
    );

    expect(queue.total).toBe(1);
    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0]?.group).toBe("failed");
    expect(queue.groups[0]?.label).toBe("失败/需重跑");
    expect(queue.groups[0]?.items[0]).toMatchObject({
      slideId: "slide-page-01",
      pageLabel: "page-01",
      group: "failed",
      reason: "MASK_FAILED: 遮罩生成失败",
      stage: "mask",
    });
  });

  it("interrupted 与 stale 同样归入失败组，无 lastError 时给通用文案", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "clean",
          stageStatus: "interrupted",
        }),
        makeSlide({
          pageLabel: "page-02",
          currentStage: "pptx",
          stageStatus: "stale",
        }),
      ],
      {},
    );

    expect(queue.total).toBe(2);
    expect(queue.groups[0]?.items.map((item) => item.reason)).toEqual([
      "阶段「生成干净底图」执行中断",
      "阶段「生成 PPTX」上游已变更，需重跑",
    ]);
  });

  /*
   * CLI `computeProgress` 的 currentStage/stageStatus 是错位的一对：前者是最后一个
   * **已完成**的阶段，后者取它**下一个**阶段的失败态。照字面拼就成了
   * 「阶段「AI 辅助复核」上游已变更」，而 assist-review 是 completed，真失效的是 mask
   * （2026-07-29 阶段 E 走查实测，与同页控制台卡片的措辞对不上）。
   */
  it("文案指名真正失效的阶段，而不是 currentStage 里那个已完成的", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "assist-review",
          stageStatus: "stale",
          stageStatuses: {
            ocr: "completed",
            review: "completed",
            "assist-review": "completed",
            mask: "stale",
            clean: "stale",
          },
        }),
      ],
      {},
    );

    expect(queue.groups[0]?.items[0]?.reason).toBe(
      "阶段「生成遮罩」上游已变更，需重跑",
    );
  });

  it("会话层 validation-failed 归入需修数据错误组", () => {
    const slide = makeSlide({
      pageLabel: "page-01",
      currentStage: "assist-review",
      completed: THROUGH_REVIEW,
    });
    const queue = deriveTodoQueue([slide], {
      [slide.slideId]: sessionResult(slide.slideId, "validation-failed"),
    });

    expect(queue.total).toBe(1);
    expect(queue.groups[0]?.group).toBe("fix-validation");
    expect(queue.groups[0]?.label).toBe("需修数据错误");
    expect(queue.groups[0]?.items[0]?.stage).toBe("validate-review");
  });

  it("review 完成且仍有未复核版式文字 → 需文本复核组，原因带块数", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "assist-review",
          completed: THROUGH_REVIEW,
          pendingTextReview: 45,
        }),
      ],
      {},
    );

    expect(queue.groups[0]?.group).toBe("review-text");
    expect(queue.groups[0]?.label).toBe("需文本复核");
    expect(queue.groups[0]?.items[0]).toMatchObject({
      reason: "45 个版式目标文字待复核",
      stage: "review",
    });
  });

  it("pendingTextReview 为 0 时不进需文本复核组", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "assist-review",
          completed: THROUGH_REVIEW,
          pendingTextReview: 0,
        }),
      ],
      {},
    );

    expect(queue.total).toBe(0);
  });

  it("review 未完成时即便块数非 0 也不进需文本复核组", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "ocr",
          completed: [...SOURCE_CONFIRMED, "ocr"],
          pendingTextReview: 12,
        }),
      ],
      {},
    );

    expect(queue.total).toBe(0);
  });

  it("会话层 human-edit 命中需文本复核组（耐久块数尚未刷新时的兜底）", () => {
    const slide = makeSlide({
      pageLabel: "page-01",
      currentStage: "assist-review",
      completed: THROUGH_REVIEW,
      pendingTextReview: 0,
    });
    const queue = deriveTodoQueue([slide], {
      [slide.slideId]: sessionResult(slide.slideId, "human-edit"),
    });

    expect(queue.groups[0]?.group).toBe("review-text");
    expect(queue.groups[0]?.items[0]?.reason).toBe("存在待复核的版式目标文字");
  });

  it("pptx 完成且 accept-pptx 未完成 → 待最终确认组", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
        }),
      ],
      {},
    );

    expect(queue.groups[0]?.group).toBe("final-confirm");
    expect(queue.groups[0]?.label).toBe("待最终确认");
    expect(queue.groups[0]?.items[0]).toMatchObject({
      reason: "PPTX 已生成，等待最终确认",
      stage: "accept-pptx",
    });
  });

  /*
   * 2026-07-30 R2 的回归保护：最终确认页的可达判据放宽为「pptx 已完成」，但队列
   * 判据必须仍是「pptx 完成且 accept-pptx 未完成」。两者共用 accept-gate.ts，
   * 跟错一处就会重演该文件注释里记的语义漂移——只是方向相反：队列把已经验收完的
   * 页重新列成待办，用户永远处理不完。
   */
  it("accept-pptx 已完成的页不再入队（确认页可达不等于待办）", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "accept-pptx",
          completed: [...THROUGH_PPTX, "accept-pptx"],
        }),
      ],
      {},
    );

    expect(queue.total).toBe(0);
  });

  it("clean 完成但 pptx 未完成时不产生待办（accept-clean 不再单独停顿）", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "clean",
          completed: THROUGH_CLEAN,
        }),
      ],
      {},
    );

    expect(queue.total).toBe(0);
  });
});

describe("deriveTodoQueue 优先级与去重", () => {
  it("失败态优先于其余全部判据", () => {
    const slide = makeSlide({
      pageLabel: "page-01",
      currentStage: "pptx",
      stageStatus: "failed",
      completed: THROUGH_PPTX,
      pendingTextReview: 3,
    });
    const queue = deriveTodoQueue([slide], {
      [slide.slideId]: sessionResult(slide.slideId, "validation-failed"),
    });

    expect(queue.total).toBe(1);
    expect(queue.groups[0]?.group).toBe("failed");
  });

  it("validation-failed 优先于需文本复核与待最终确认", () => {
    const slide = makeSlide({
      pageLabel: "page-01",
      currentStage: "pptx",
      completed: THROUGH_PPTX,
      pendingTextReview: 3,
    });
    const queue = deriveTodoQueue([slide], {
      [slide.slideId]: sessionResult(slide.slideId, "validation-failed"),
    });

    expect(queue.total).toBe(1);
    expect(queue.groups[0]?.group).toBe("fix-validation");
  });

  it("需文本复核优先于待最终确认（先把文字定下来再看成品）", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
          pendingTextReview: 3,
        }),
      ],
      {},
    );

    expect(queue.total).toBe(1);
    expect(queue.groups[0]?.group).toBe("review-text");
  });

  it("组顺序固定为 failed → confirm-source → fix-validation → review-text → final-confirm", () => {
    const revalidating = makeSlide({
      pageLabel: "page-03",
      currentStage: "assist-review",
      completed: THROUGH_REVIEW,
    });
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-05",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
        }),
        makeSlide({
          pageLabel: "page-04",
          currentStage: "assist-review",
          completed: THROUGH_REVIEW,
          pendingTextReview: 7,
        }),
        revalidating,
        // 生成图，停在源图确认：init 完成、accept-source 仍 pending
        makeSlide({ pageLabel: "page-02", currentStage: "init" }),
        makeSlide({
          pageLabel: "page-01",
          currentStage: "ocr",
          stageStatus: "failed",
        }),
      ],
      {
        [revalidating.slideId]: sessionResult(
          revalidating.slideId,
          "validation-failed",
        ),
      },
    );

    expect(queue.groups.map((group) => group.group)).toEqual([
      "failed",
      "confirm-source",
      "fix-validation",
      "review-text",
      "final-confirm",
    ]);
    expect(queue.total).toBe(5);
  });
});

describe("deriveTodoQueue 过滤与排序", () => {
  it("已移除的页不进入队列", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "mask",
          stageStatus: "failed",
          removed: true,
        }),
        makeSlide({
          pageLabel: "page-02",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
          removed: true,
        }),
      ],
      {},
    );

    expect(queue.total).toBe(0);
    expect(queue.groups).toEqual([]);
  });

  it("全部完成时返回空队列", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({ pageLabel: "page-01", completed: ALL_DONE }),
        makeSlide({ pageLabel: "page-02", completed: ALL_DONE }),
      ],
      {},
    );

    expect(queue.total).toBe(0);
    expect(queue.groups).toHaveLength(0);
  });

  it("组内按 pageLabel 数字自然序排列（page-2 在 page-10 之前）", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-10",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
        }),
        makeSlide({
          pageLabel: "page-2",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
        }),
        makeSlide({
          pageLabel: "page-1",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
        }),
      ],
      {},
    );

    expect(queue.groups[0]?.items.map((item) => item.pageLabel)).toEqual([
      "page-1",
      "page-2",
      "page-10",
    ]);
  });
});

describe("flattenTodoQueue / nextTodoItem（处理下一项）", () => {
  /** 失败 page-01 → 需文本复核 page-03 → 待最终确认 page-04 三项队列 */
  function mixedQueue() {
    return deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-04",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
        }),
        makeSlide({
          pageLabel: "page-03",
          currentStage: "assist-review",
          completed: THROUGH_REVIEW,
          pendingTextReview: 5,
        }),
        makeSlide({
          pageLabel: "page-01",
          currentStage: "ocr",
          stageStatus: "failed",
        }),
      ],
      {},
    );
  }

  it("摊平顺序等于组顺序", () => {
    expect(
      flattenTodoQueue(mixedQueue()).map((item) => item.pageLabel),
    ).toEqual(["page-01", "page-03", "page-04"]);
  });

  it("从当前页往后取下一项", () => {
    expect(nextTodoItem(mixedQueue(), "slide-page-01")?.pageLabel).toBe(
      "page-03",
    );
    expect(nextTodoItem(mixedQueue(), "slide-page-03")?.pageLabel).toBe(
      "page-04",
    );
  });

  it("走到末尾回绕到队首（前面的组可能还没处理完）", () => {
    expect(nextTodoItem(mixedQueue(), "slide-page-04")?.pageLabel).toBe(
      "page-01",
    );
  });

  it("当前页不在队列中时返回队首", () => {
    expect(nextTodoItem(mixedQueue(), "slide-page-99")?.pageLabel).toBe(
      "page-01",
    );
    expect(nextTodoItem(mixedQueue(), null)?.pageLabel).toBe("page-01");
  });

  it("队列为空或唯一待办就是当前页时返回 null（调用方据此禁用按钮）", () => {
    const empty = deriveTodoQueue(
      [makeSlide({ pageLabel: "page-01", completed: ALL_DONE })],
      {},
    );
    expect(nextTodoItem(empty, "slide-page-01")).toBeNull();

    const single = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
        }),
      ],
      {},
    );
    expect(nextTodoItem(single, "slide-page-01")).toBeNull();
    expect(nextTodoItem(single, null)?.pageLabel).toBe("page-01");
  });
});
