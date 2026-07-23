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
  const [exportResult, setExportResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [strict, setStrict] = useState(false);

  async function handleOpen(): Promise<void> {
    const dir = await window.api.system.selectDirectory();
    if (!dir) return;
    await openDeck(dir);
  }

  async function handleCreate(): Promise<void> {
    const imagesDir = await window.api.system.selectDirectory();
    if (!imagesDir) return;
    const parentDir = imagesDir.split("/").slice(0, -1).join("/");
    const name = imagesDir.split("/").pop() ?? "deck";
    const ts = new Date().toISOString().slice(0, 10);
    const workspacePath = `${parentDir}/${name}-${ts}`;
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
      setExportResult({
        ok: true,
        message: `导出成功：${result.nativeSlides} 页原生 + ${result.placeholderSlides} 页占位 → ${result.outputPath}`,
      });
      void refreshStatus();
    } catch (err) {
      setExportResult({
        ok: false,
        message: `导出失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExporting(false);
    }
  }

  if (!deckPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-10 px-6">
        <div className="text-center">
          <h2 className="text-2xl font-medium text-ink">PPT Maker</h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-body">
            可视化复核 PPT 中的文字检测结果，运行去字和重建
            Pipeline，导出为可编辑 PPTX。
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void handleOpen()}
            disabled={loading}
            className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-on-primary transition active:bg-primary-active disabled:opacity-50"
          >
            打开已有 Deck
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={loading}
            className="rounded-lg border border-hairline bg-canvas px-6 py-3 text-sm font-medium text-ink transition active:border-border-strong disabled:opacity-50"
          >
            从图片目录创建
          </button>
        </div>

        <div className="max-w-xs text-center text-xs leading-relaxed text-muted">
          <p>
            <strong className="font-medium text-body">打开</strong> —
            选择一个已有的 Deck 工作区目录
          </p>
          <p className="mt-1">
            <strong className="font-medium text-body">创建</strong> — 选择包含
            PPT 截图的图片目录，自动在同级目录创建工作区
          </p>
        </div>

        {error && (
          <p className="rounded-sm bg-error-light px-4 py-2 text-sm text-error">
            {error}
          </p>
        )}
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
            className="rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink transition active:border-border-strong disabled:opacity-50"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={() => void handleAddSlide()}
            disabled={loading}
            className="rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink transition active:border-border-strong disabled:opacity-50"
          >
            添加页面
          </button>
          <label
            className="flex items-center gap-1.5 text-xs text-muted"
            title="要求所有页面通过 accept-pptx 验收后才允许导出"
          >
            <input
              type="checkbox"
              checked={strict}
              onChange={(e) => setStrict(e.target.checked)}
            />
            严格模式
          </label>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={loading || exporting}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition active:bg-primary-active disabled:opacity-50"
          >
            {exporting ? "导出中…" : "导出 PPTX"}
          </button>
        </div>
      </div>
      {error && (
        <p className="border-b border-hairline bg-error-light px-6 py-2 text-sm text-error">
          {error}
        </p>
      )}
      {exportResult && (
        <p
          className={`border-b border-hairline px-6 py-2 text-sm ${
            exportResult.ok
              ? "bg-success/10 text-success"
              : "bg-error-light text-error"
          }`}
        >
          {exportResult.message}
        </p>
      )}
      <div className="flex-1 overflow-auto p-6">
        <SlideGrid />
      </div>
    </div>
  );
}
