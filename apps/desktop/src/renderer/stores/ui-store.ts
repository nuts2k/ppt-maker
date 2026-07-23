import { create } from "zustand";

type AppView = "welcome" | "deck" | "slide";
type SidebarPanel = "properties" | "sources" | "queue";

interface UIState {
  currentView: AppView;
  selectedSlideId: string | null;
  selectedBlockId: string | null;
  sidebarPanel: SidebarPanel;

  setView(view: AppView): void;
  selectSlide(slideId: string | null): void;
  selectBlock(blockId: string | null): void;
  setSidebarPanel(panel: SidebarPanel): void;
}

export const useUIStore = create<UIState>((set) => ({
  currentView: "welcome",
  selectedSlideId: null,
  selectedBlockId: null,
  sidebarPanel: "properties",

  setView(view) {
    set({ currentView: view });
  },

  selectSlide(slideId) {
    // 切换选中页时清空 block 选区，避免残留到新页面
    set({ selectedSlideId: slideId, selectedBlockId: null });
  },

  selectBlock(blockId) {
    set({ selectedBlockId: blockId });
  },

  setSidebarPanel(panel) {
    set({ sidebarPanel: panel });
  },
}));
