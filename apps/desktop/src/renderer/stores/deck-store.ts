import { create } from "zustand";
import type { SlideDetail } from "../../main/ipc/channels.js";
import {
  applyDetailedResult,
  type DeckSummary,
  filterActiveSlides,
  findSlideById,
  replaceSlide,
} from "./deck-merge.js";

interface DeckState {
  // Deck 根目录路径，null 表示尚未打开任何 Deck
  deckPath: string | null;
  name: string | null;
  deckId: string | null;
  /** 逐页耐久状态（阶段轨道 / 最近失败 / 阶段耗时），来源 deck:status-detailed */
  slides: readonly SlideDetail[];
  summary: DeckSummary | null;
  // 正在执行 IPC 请求时为 true，用于展示加载态
  loading: boolean;
  error: string | null;

  openDeck(path: string): Promise<void>;
  createDeck(
    imagesDir: string,
    workspacePath: string,
    name?: string,
  ): Promise<void>;
  refreshStatus(): Promise<void>;
  refreshSlide(slideId: string): Promise<void>;
  addSlide(imagePath: string): Promise<void>;
  removeSlide(pageLabel: string): Promise<void>;
  reset(): void;

  /** 按 slideId 取页详情；SlideDetail 已含 absWorkspacePath / pageLabel，调用方无需拼路径 */
  getSlide(slideId: string): SlideDetail | undefined;
  /** 未被软删除的页，控制台与批量执行的展示口径 */
  activeSlides(): readonly SlideDetail[];
}

export const useDeckStore = create<DeckState>((set, get) => ({
  deckPath: null,
  name: null,
  deckId: null,
  slides: [],
  summary: null,
  loading: false,
  error: null,

  async openDeck(path) {
    set({ loading: true, error: null });
    try {
      // 先 open 建立会话并校验目录合法，再取 detailed 填充阶段轨道
      const opened = await window.api.deck.open(path);
      const detailed = await window.api.deck.statusDetailed(opened.deckPath);
      set({ ...applyDetailedResult(detailed), loading: false });
    } catch (err) {
      set({ loading: false, error: toMessage(err) });
      throw err;
    }
  },

  async createDeck(imagesDir, workspacePath, name) {
    set({ loading: true, error: null });
    try {
      // 实际 deck 路径由 main 生成（工作区子目录名），必须以返回值为准
      const created = await window.api.deck.create(
        imagesDir,
        workspacePath,
        name,
      );
      const detailed = await window.api.deck.statusDetailed(created.deckPath);
      set({ ...applyDetailedResult(detailed), loading: false });
    } catch (err) {
      set({ loading: false, error: toMessage(err) });
      throw err;
    }
  },

  async refreshStatus() {
    const { deckPath } = get();
    if (!deckPath) return;
    set({ loading: true, error: null });
    try {
      const detailed = await window.api.deck.statusDetailed(deckPath);
      // 请求期间可能已切换工作区，此时写回会把旧 deck 的页贴到新 deck 上
      if (get().deckPath !== deckPath) return;
      set({ ...applyDetailedResult(detailed), loading: false });
    } catch (err) {
      // 迟到的失败同样不写：错误条会指着一个用户已经离开的工作区
      if (get().deckPath === deckPath) {
        set({ loading: false, error: toMessage(err) });
      }
      throw err;
    }
  },

  /**
   * 单页增量刷新（page-done 后调用）。
   *
   * 权衡：当前 IPC 只有 deck 级 `status-detailed`，没有单页接口（阶段 A 已定型，
   * 本阶段不改 main）。因此仍整体拉取，但**只替换该页对象**并且不置 loading——
   * 其余页保持原引用，批量执行中卡片不会整片重渲染、也不会闪加载态。
   * 目标页不在返回结果中（例如刚被移除）时退化为整体套用。
   */
  async refreshSlide(slideId) {
    const { deckPath } = get();
    if (!deckPath) return;
    try {
      const detailed = await window.api.deck.statusDetailed(deckPath);
      // 同 refreshStatus：切换工作区后迟到的结果一律丢弃
      if (get().deckPath !== deckPath) return;
      const next = findSlideById(detailed.slides, slideId);
      if (!next) {
        set(applyDetailedResult(detailed));
        return;
      }
      set((state) => ({
        slides: replaceSlide(state.slides, next),
        // 摘要是 deck 级聚合，随同一次请求一并更新，避免与卡片状态脱节
        summary: detailed.summary,
      }));
    } catch (err) {
      if (get().deckPath === deckPath) set({ error: toMessage(err) });
      throw err;
    }
  },

  async addSlide(imagePath) {
    const { deckPath, refreshStatus } = get();
    if (!deckPath) return;
    set({ loading: true, error: null });
    try {
      await window.api.deck.addSlide(deckPath, imagePath);
      await refreshStatus();
    } catch (err) {
      set({ loading: false, error: toMessage(err) });
      throw err;
    }
  },

  async removeSlide(pageLabel) {
    const { deckPath, refreshStatus } = get();
    if (!deckPath) return;
    set({ loading: true, error: null });
    try {
      await window.api.deck.removeSlide(deckPath, pageLabel);
      await refreshStatus();
    } catch (err) {
      set({ loading: false, error: toMessage(err) });
      throw err;
    }
  },

  reset() {
    set({
      deckPath: null,
      name: null,
      deckId: null,
      slides: [],
      summary: null,
      loading: false,
      error: null,
    });
  },

  getSlide(slideId) {
    return findSlideById(get().slides, slideId);
  },

  activeSlides() {
    return filterActiveSlides(get().slides);
  },
}));

/** 组件内订阅用选择器：`useDeckStore((s) => selectSlideById(s, id))` */
export function selectSlideById(
  state: DeckState,
  slideId: string,
): SlideDetail | undefined {
  return findSlideById(state.slides, slideId);
}

/** 组件内订阅用选择器；返回新数组，需配合 useMemo 或浅比较使用 */
export function selectActiveSlides(state: DeckState): readonly SlideDetail[] {
  return filterActiveSlides(state.slides);
}

export type { DeckState };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
