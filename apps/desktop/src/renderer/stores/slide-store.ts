import type { TextReviewBlock, TextReviewDocument } from "@ppt-maker/core";
import { create } from "zustand";
import { getApi } from "@/lib/ipc-client";

interface SlideState {
  // 当前 slide 的工作区路径与标识
  slideId: string | null;
  workspacePath: string | null;
  // 复核文档（review/text-blocks.json 的内存副本）
  reviewDocument: TextReviewDocument | null;
  // 底图与去字底板，均为 base64 data URL
  sourceImageUrl: string | null;
  cleanPlateUrl: string | null;
  // 是否有未保存改动
  dirty: boolean;
  loading: boolean;

  // 并行加载复核文档、源图、去字底板
  loadSlide(workspacePath: string): Promise<void>;
  // 局部更新指定 block 字段并标记 dirty
  updateBlock(blockId: string, patch: Partial<TextReviewBlock>): void;
  // 保存复核文档，成功后清除 dirty
  saveReview(): Promise<{ valid: boolean; errors: number; warnings: number }>;
  reset(): void;
}

const INITIAL_STATE = {
  slideId: null,
  workspacePath: null,
  reviewDocument: null,
  sourceImageUrl: null,
  cleanPlateUrl: null,
  dirty: false,
  loading: false,
} as const;

export const useSlideStore = create<SlideState>((set, get) => ({
  ...INITIAL_STATE,

  async loadSlide(workspacePath) {
    set({ loading: true, workspacePath });
    const api = getApi();
    const [reviewDocument, sourceImageUrl, cleanPlateUrl] = await Promise.all([
      api.slide.loadReview(workspacePath),
      api.slide.loadImage(workspacePath, "source_image"),
      api.slide.loadImage(workspacePath, "clean_plate"),
    ]);
    set({
      reviewDocument,
      sourceImageUrl,
      cleanPlateUrl,
      slideId: reviewDocument?.slideId ?? null,
      dirty: false,
      loading: false,
    });
  },

  updateBlock(blockId, patch) {
    const { reviewDocument } = get();
    if (reviewDocument === null) {
      return;
    }
    const blocks = reviewDocument.blocks.map((block) =>
      block.id === blockId ? { ...block, ...patch } : block,
    );
    set({
      reviewDocument: { ...reviewDocument, blocks },
      dirty: true,
    });
  },

  async saveReview() {
    const { workspacePath, reviewDocument } = get();
    if (workspacePath === null || reviewDocument === null) {
      throw new Error("当前没有可保存的复核文档");
    }
    const result = await getApi().slide.saveReview(
      workspacePath,
      reviewDocument,
    );
    set({ dirty: false });
    return result;
  },

  reset() {
    set({ ...INITIAL_STATE });
  },
}));
