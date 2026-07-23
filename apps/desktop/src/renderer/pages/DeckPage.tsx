import { useState } from "react";
import { SlideGrid } from "@/components/deck/SlideGrid";
import { useDeckStore } from "@/stores/deck-store";

export function DeckPage(): React.JSX.Element {
  const deckPath = useDeckStore((s) => s.deckPath);
  const loading = useDeckStore((s) => s.loading);
  const error = useDeckStore((s) => s.error);
  const openDeck = useDeckStore((s) => s.openDeck);
  const createDeck = useDeckStore((s) => s.createDeck);
  const refreshStatus = useDeckStore((s) => s.refreshStatus);
  const addSlide = useDeckStore((s) => s.addSlide);
  const summary = useDeckStore((s) => s.summary);

  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [strict, setStrict] = useState(false);

  async function handleOpen(): Promise<void> {
    const dir = await window.api.system.selectDirectory();
    if (!dir) return;
    await openDeck(dir);
  }

  async function handleCreate(): Promise<void> {
    const imagesDir = await window.api.system.selectDirectory();
    if (!imagesDir) return;
    const workspacePath = await window.api.system.selectDirectory();
    if (!workspacePath) return;
    await createDeck(imagesDir, workspacePath);
  }

  async function handleAddSlide(): Promise<void> {
    if (!deckPath) return;
    const imagePath = await window.api.system.selectFile([
      { name: "图片", extensions: ["png", "jpg", "jpeg"] },
    ]);
    if (!imagePath) return;
    await addSlide(imagePath);
  }

  async function handleExport(): Promise<void> {
    if (!deckPath) return;
    const outputPath = await window.api.system.saveFileDialog("output.pptx");
    if (!outputPath) return;
    setExporting(true);
    setExportResult(null);
    try {
      const result = await window.api.deck.export(deckPath, outputPath, strict);
      setExportResult(
        `导出成功：${result.nativeSlides} 页原生 + ${result.placeholderSlides} 页占位 → ${result.outputPath}`,
      );
      void refreshStatus();
    } catch (err) {
      setExportResult(
        `导出失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setExporting(false);
    }
  }

  if (!deckPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-ink">PPT Maker</h2>
          <p className="mt-2 text-sm text-muted">
            打开一个已有 Deck，或从图片目录创建新的 Deck
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void handleOpen()}
            disabled={loading}
            className="rounded-lg border border-hairline bg-canvas px-5 py-2.5 text-sm font-medium text-ink transition hover:border-border-strong disabled:opacity-50"
          >
            打开已有 Deck
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={loading}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-on-primary transition hover:bg-primary-active disabled:opacity-50"
          >
            创建新 Deck
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-hairline px-6 py-3">
        <div className="flex items-center gap-3 text-sm text-muted">
          {summary && (
            <span>
              共 {summary.total} 页 · 已完成 {summary.completed} · 进行中{" "}
              {summary.inProgress} · 未开始 {summary.notStarted}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={loading}
            className="rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink transition hover:border-border-strong disabled:opacity-50"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={() => void handleAddSlide()}
            disabled={loading}
            className="rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink transition hover:border-border-strong disabled:opacity-50"
          >
            添加页面
          </button>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={strict}
              onChange={(e) => setStrict(e.target.checked)}
            />
            Strict
          </label>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={loading || exporting}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition hover:bg-primary-active disabled:opacity-50"
          >
            {exporting ? "导出中…" : "导出 PPTX"}
          </button>
        </div>
      </div>
      {error && (
        <p className="border-b border-hairline bg-red-50 px-6 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {exportResult && (
        <p className="border-b border-hairline bg-surface-soft px-6 py-2 text-sm text-body">
          {exportResult}
        </p>
      )}
      <div className="flex-1 overflow-auto p-6">
        <SlideGrid />
      </div>
    </div>
  );
}
