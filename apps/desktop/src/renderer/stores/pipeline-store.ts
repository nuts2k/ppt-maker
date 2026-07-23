import { create } from "zustand";
import { getApi } from "@/lib/ipc-client";

type StageStatus = "pending" | "running" | "completed" | "failed";
type PendingGate = "accept-clean" | "accept-pptx" | null;

interface PipelineState {
  // pipeline 是否正在执行
  running: boolean;
  currentSlideId: string | null;
  // 各阶段状态映射，键为 stage 名
  stageStatuses: Record<string, StageStatus>;
  // 需要人工确认的门禁（去字底板 / PPTX），null 表示无待处理门禁
  pendingGate: PendingGate;
  error: { code: string; message: string } | null;

  // 从指定阶段启动 pipeline；进度事件监听在后续阶段接入
  startPipeline(
    workspacePath: string,
    from: string,
    opts?: { confirmApi?: boolean; confirmUpload?: boolean },
  ): Promise<void>;
  // 清除待处理门禁
  acceptGate(): void;
  reset(): void;
}

const INITIAL_STATE = {
  running: false,
  currentSlideId: null,
  stageStatuses: {} as Record<string, StageStatus>,
  pendingGate: null as PendingGate,
  error: null as { code: string; message: string } | null,
} as const;

export const usePipelineStore = create<PipelineState>((set) => ({
  ...INITIAL_STATE,

  async startPipeline(workspacePath, from, opts) {
    set({ running: true, error: null });
    try {
      await getApi().slide.run(workspacePath, from, opts);
    } catch (error) {
      set({
        error: {
          code: "PIPELINE_RUN_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      set({ running: false });
    }
  },

  acceptGate() {
    set({ pendingGate: null });
  },

  reset() {
    set({ ...INITIAL_STATE, stageStatuses: {} });
  },
}));
