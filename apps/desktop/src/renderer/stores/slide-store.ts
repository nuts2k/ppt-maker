import type { TextReviewBlock, TextReviewDocument } from "@ppt-maker/core";
import { create } from "zustand";
import type { SaveReviewResult } from "../../main/ipc/channels.js";
// 相对 `.js` 导入而非 `@/` 别名：test 走 tsconfig.node.json，别名在那边解析不到，
// 本 store 的时序守卫需要能被直接单测（同 run-bridge.ts 的取舍）
import {
  applyManualEdit,
  deleteBlockById,
  markBlocksReviewedById,
} from "../lib/block-edit.js";
import { getApi } from "../lib/ipc-client.js";

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
  /**
   * 只重载底图与去字底板，不触碰 reviewDocument / dirty。
   *
   * 去字底板由 clean 阶段产出，进页时通常还不存在，而 loadSlide 只在切页时触发，
   * 于是 accept-clean 闸门拿到的永远是进页那一刻的快照（表现为对比区提示
   * "缺少原图或去字底板"）。不复用 loadSlide 是因为它会重置复核文档，
   * 会吞掉用户尚未保存的改动。
   */
  reloadImages(): Promise<void>;
  /**
   * 人工编辑指定 block（文本 / 分类 / includeInMask 等）：合并 patch，
   * 写入 `updatedAt` 并同步 manual 来源，标记 dirty。
   *
   * 溯源必须写在编辑路径上而非确认路径上，否则 report 中的「已复核」无法区分
   * 「人工改过」与「一键放行」（PRD F-6）。
   */
  updateBlock(blockId: string, patch: Partial<TextReviewBlock>): void;
  /** 仅推进单块复核状态（Enter 确认当前项）：不写 updatedAt、不加 manual 来源 */
  markBlockReviewed(blockId: string): void;
  /** 把指定块批量标为已复核（「全部通过」），返回实际改动数；同样不写溯源字段 */
  markBlocksReviewed(blockIds: readonly string[]): number;
  /** 删除块（列表上的「删除此块」），标记 dirty */
  deleteBlock(blockId: string): void;
  /**
   * 保存复核文档，成功后清除 dirty。
   *
   * 返回值透传 main 侧的 `invalidated`（本次保存连带作废的阶段），
   * 调用方据此清理会话层阶段态并提示用户重跑——不能吞掉，否则界面会继续显示旧的完成态。
   */
  saveReview(): Promise<SaveReviewResult>;
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
    // 加载期间可能已切页或切换工作区（切换会 reset 掉 workspacePath），
    // 此时写回会把上一页的复核文档贴到新页上
    if (get().workspacePath !== workspacePath) return;
    set({
      reviewDocument,
      sourceImageUrl,
      cleanPlateUrl,
      slideId: reviewDocument?.slideId ?? null,
      dirty: false,
      loading: false,
    });
  },

  async reloadImages() {
    const { workspacePath } = get();
    if (workspacePath === null) return;
    const api = getApi();
    const [sourceImageUrl, cleanPlateUrl] = await Promise.all([
      api.slide.loadImage(workspacePath, "source_image"),
      api.slide.loadImage(workspacePath, "clean_plate"),
    ]);
    // 加载期间可能已切页，此时写回会把上一页的图贴到新页上
    if (get().workspacePath !== workspacePath) return;
    set({ sourceImageUrl, cleanPlateUrl });
  },

  updateBlock(blockId, patch) {
    const { reviewDocument } = get();
    if (reviewDocument === null) {
      return;
    }
    const now = new Date().toISOString();
    const blocks = reviewDocument.blocks.map((block) =>
      block.id === blockId ? applyManualEdit(block, patch, now) : block,
    );
    set({
      reviewDocument: { ...reviewDocument, blocks },
      dirty: true,
    });
  },

  markBlockReviewed(blockId) {
    get().markBlocksReviewed([blockId]);
  },

  markBlocksReviewed(blockIds) {
    const { reviewDocument } = get();
    if (reviewDocument === null) return 0;
    const { blocks, changed } = markBlocksReviewedById(
      reviewDocument.blocks,
      blockIds,
    );
    if (changed === 0) return 0;
    set({
      reviewDocument: { ...reviewDocument, blocks: [...blocks] },
      dirty: true,
    });
    return changed;
  },

  deleteBlock(blockId) {
    const { reviewDocument } = get();
    if (reviewDocument === null) return;
    const { blocks, deleted } = deleteBlockById(reviewDocument.blocks, blockId);
    if (!deleted) return;
    set({
      reviewDocument: { ...reviewDocument, blocks: [...blocks] },
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
