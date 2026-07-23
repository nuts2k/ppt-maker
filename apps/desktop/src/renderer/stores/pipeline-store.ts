import { create } from "zustand";
import { getApi } from "@/lib/ipc-client";

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
    set({ running: true, error: null, stageStatuses: {}, pendingGate: null });

    const unsubscribe = getApi().onPipelineProgress((event) => {
      const { stageStatuses } = get();
      set({
        stageStatuses: {
          ...stageStatuses,
          [event.stage]: event.status,
        },
        ...(event.gate ? { pendingGate: event.gate } : {}),
        ...(event.error
          ? { error: { code: event.error.code, message: event.error.message } }
          : {}),
      });
    });

    try {
      const result = await getApi().slide.run(workspacePath, from, opts);
      if (result.gate === "accept-clean" || result.gate === "accept-pptx") {
        set({ pendingGate: result.gate });
      } else if (result.gate) {
        set({
          error: {
            code: `PIPELINE_GATE_${result.gate.toUpperCase()}`,
            message: result.message,
          },
        });
      }
    } catch (error) {
      set({
        error: {
          code: "PIPELINE_RUN_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      unsubscribe();
      set({ running: false });
    }
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
