import { isRunStage, type RunStage } from "@shared/stages";
import { create } from "zustand";
import { getApi } from "@/lib/ipc-client";
import { useDeckStore } from "@/stores/deck-store";

/**
 * 过渡实现：对外接口保持 V1 形状（SlidePage 暂未重写），内部已切到 DeckRunner。
 * 阶段 B1 会由 run-store 取代本文件，届时连同 SlidePage 的消费点一并移除。
 */

type StageStatus = "pending" | "running" | "completed" | "failed";
type PendingGate = "accept-clean" | "accept-pptx" | null;

interface PipelineState {
  running: boolean;
  currentSlideId: string | null;
  stageStatuses: Record<string, StageStatus>;
  pendingGate: PendingGate;
  error: { code: string; message: string } | null;

  startPipeline(
    workspacePath: string,
    from: string,
    opts?: { confirmApi?: boolean; confirmUpload?: boolean },
  ): Promise<void>;
  acceptGate(): void;
  reset(): void;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  running: false,
  currentSlideId: null,
  stageStatuses: {},
  pendingGate: null,
  error: null,

  async startPipeline(workspacePath, from, opts) {
    const { deckPath, slides } = useDeckStore.getState();
    const slide = slides.find((s) => workspacePath.endsWith(s.workspacePath));

    if (deckPath === null || slide === undefined || !isRunStage(from)) {
      set({
        error: {
          code: "PIPELINE_TARGET_UNRESOLVED",
          message: "无法定位待执行页面",
        },
      });
      return;
    }

    set({
      running: true,
      error: null,
      stageStatuses: {},
      pendingGate: null,
      currentSlideId: slide.slideId,
    });

    // DeckRunner 的 run-start 只表示"已排队"，执行结束以 run-done 事件为准
    await new Promise<void>((resolvePromise) => {
      const unsubscribe = getApi().onDeckRunProgress((event) => {
        if (event.kind === "stage-start") {
          set({
            stageStatuses: { ...get().stageStatuses, [event.stage]: "running" },
          });
          return;
        }
        if (event.kind === "stage-complete") {
          set({
            stageStatuses: {
              ...get().stageStatuses,
              [event.stage]: "completed",
            },
          });
          return;
        }
        if (event.kind === "page-done") {
          if (event.gate === "manual" && event.stoppedAt !== null) {
            if (
              event.stoppedAt === "accept-clean" ||
              event.stoppedAt === "accept-pptx"
            ) {
              set({ pendingGate: event.stoppedAt });
            }
          } else if (event.error !== null) {
            set({
              error: {
                code: event.error.code,
                message: event.error.message,
              },
            });
          } else if (event.gate !== null) {
            set({
              error: {
                code: `PIPELINE_GATE_${event.gate.toUpperCase()}`,
                message: event.message,
              },
            });
          }
          return;
        }
        if (event.kind === "run-done") {
          unsubscribe();
          set({ running: false });
          resolvePromise();
        }
      });

      void getApi()
        .deck.runStart(deckPath, {
          slideIds: [slide.slideId],
          from: from as RunStage,
          ...(opts?.confirmApi === true ? { confirmApi: true } : {}),
          ...(opts?.confirmUpload === true ? { confirmUpload: true } : {}),
        })
        .then((result) => {
          if (!result.accepted) {
            unsubscribe();
            set({
              running: false,
              error: {
                code: "PIPELINE_RUN_REJECTED",
                message: result.message,
              },
            });
            resolvePromise();
          }
        })
        .catch((error: unknown) => {
          unsubscribe();
          set({
            running: false,
            error: {
              code: "PIPELINE_RUN_FAILED",
              message: error instanceof Error ? error.message : String(error),
            },
          });
          resolvePromise();
        });
    });
  },

  acceptGate() {
    set({ pendingGate: null });
  },

  reset() {
    set({
      running: false,
      currentSlideId: null,
      stageStatuses: {},
      pendingGate: null,
      error: null,
    });
  },
}));
