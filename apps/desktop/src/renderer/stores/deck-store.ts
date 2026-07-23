import { create } from "zustand";
import type {
  DeckStatusResult,
  DeckStatusSlide,
} from "../../main/ipc/channels.js";

type DeckSummary = DeckStatusResult["summary"];

interface DeckState {
  // Deck 根目录路径，null 表示尚未打开任何 Deck
  deckPath: string | null;
  name: string | null;
  deckId: string | null;
  slides: DeckStatusSlide[];
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
  addSlide(imagePath: string): Promise<void>;
  removeSlide(pageLabel: string): Promise<void>;
  reset(): void;
}

// 将 IPC 返回的 Deck 状态写入 store
function applyResult(result: DeckStatusResult): Partial<DeckState> {
  return {
    deckPath: result.deckPath,
    name: result.name,
    deckId: result.deckId,
    slides: [...result.slides],
    summary: result.summary,
  };
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
      const result = await window.api.deck.open(path);
      set({ ...applyResult(result), loading: false });
    } catch (err) {
      set({ loading: false, error: toMessage(err) });
      throw err;
    }
  },

  async createDeck(imagesDir, workspacePath, name) {
    set({ loading: true, error: null });
    try {
      const result = await window.api.deck.create(
        imagesDir,
        workspacePath,
        name,
      );
      set({ ...applyResult(result), loading: false });
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
      const result = await window.api.deck.status(deckPath);
      set({ ...applyResult(result), loading: false });
    } catch (err) {
      set({ loading: false, error: toMessage(err) });
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
}));

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
