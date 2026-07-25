import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/deck-store";

interface DeckEmptyStateProps {
  className?: string;
}

/**
 * 未打开 Deck 时的欢迎/入口态（design.md 3.3）。
 *
 * 纯白 canvas + 签名按钮对 + 大留白，不加任何装饰背景——
 * DESIGN.md 明确要求 hero 靠留白与字号建立层级。
 */
export function DeckEmptyState({
  className,
}: DeckEmptyStateProps): React.JSX.Element {
  const loading = useDeckStore((s) => s.loading);
  const error = useDeckStore((s) => s.error);
  const openDeck = useDeckStore((s) => s.openDeck);
  const createDeck = useDeckStore((s) => s.createDeck);

  // openDeck / createDeck 失败会 throw，此处必须吞掉：
  // 错误已写入 store 的 error 字段并在下方错误条呈现，再抛出只会变成未处理拒绝
  async function handleOpen(): Promise<void> {
    const dir = await window.api.system.selectDirectory();
    if (!dir) return;
    try {
      await openDeck(dir);
    } catch {
      // 忽略：错误由 deck-store 承载
    }
  }

  async function handleCreate(): Promise<void> {
    const imagesDir = await window.api.system.selectDirectory();
    if (!imagesDir) return;
    // 工作区建在图片目录同级，目录名带日期后缀，避免重复创建时互相覆盖
    const parentDir = imagesDir.split("/").slice(0, -1).join("/");
    const name = imagesDir.split("/").pop() ?? "deck";
    const ts = new Date().toISOString().slice(0, 10);
    try {
      await createDeck(imagesDir, `${parentDir}/${name}-${ts}`);
    } catch {
      // 忽略：错误由 deck-store 承载
    }
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-10 px-6",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-display-md font-normal text-ink">PPT Maker</h1>
        <p className="max-w-md text-sm leading-relaxed text-body">
          可视化复核 PPT
          中的文字检测结果，批量运行去字与重建流水线，导出为可编辑 PPTX。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleOpen()}
          disabled={loading}
          className="rounded-lg bg-primary px-6 py-4 text-base font-medium text-on-primary transition active:bg-primary-active disabled:opacity-40"
        >
          打开已有 Deck
        </button>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={loading}
          className="rounded-lg border border-hairline bg-canvas px-6 py-4 text-base font-medium text-ink transition active:border-border-strong disabled:opacity-40"
        >
          从图片目录创建
        </button>
      </div>

      <div className="flex max-w-sm flex-col gap-1 text-center text-sm font-medium leading-relaxed text-muted">
        <p>
          <strong className="font-medium text-body">打开</strong> —
          选择一个已有的 Deck 工作区目录
        </p>
        <p>
          <strong className="font-medium text-body">创建</strong> — 选择包含 PPT
          截图的图片目录，自动在同级创建工作区
        </p>
      </div>

      {error !== null && error !== "" && (
        <p className="rounded-sm bg-signature-coral/10 px-4 py-2 text-sm font-medium text-signature-coral">
          {error}
        </p>
      )}
    </div>
  );
}

export type { DeckEmptyStateProps };
