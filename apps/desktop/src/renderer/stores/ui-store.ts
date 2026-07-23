import { create } from "zustand";

type AppView = "welcome" | "deck" | "slide";

interface UIState {
  currentView: AppView;
  selectedSlideId: string | null;
  selectedBlockId: string | null;

  setView(view: AppView): void;
  selectSlide(slideId: string | null): void;
  selectBlock(blockId: string | null): void;
}

export const useUIStore = create<UIState>((set) => ({
  currentView: "welcome",
  selectedSlideId: null,
  selectedBlockId: null,

  setView(view) {
    set({ currentView: view });
  },

  selectSlide(slideId) {
    set({ selectedSlideId: slideId, selectedBlockId: null });
  },

  selectBlock(blockId) {
    set({ selectedBlockId: blockId });
  },
}));
