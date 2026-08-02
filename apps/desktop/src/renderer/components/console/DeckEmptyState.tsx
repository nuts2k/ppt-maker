import { FolderOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { switchWorkspace } from "@/lib/workspace-switch";
import { useDeckStore } from "@/stores/deck-store";

interface DeckEmptyStateProps {
  /** 打开来源选择模态。模态与建页任务进度都归 ConsolePage 持有 */
  readonly onCreate: () => void;
  className?: string;
}

/**
 * 未打开 Deck 时的欢迎/入口态。
 *
 * 纯白 canvas + 一对动作 + 大留白，不加任何装饰背景——层级靠留白与字号建立。
 *
 * 「新建 Deck」是这里唯一的主行动，它进的是**统一的来源选择界面**（三种来源一个
 * 入口），而不是直接弹一个图片目录选择器：三种来源分三个并列按钮正是父任务点名
 * 不要的形态。「打开已有 Deck」降为与之成对的次要动作。
 */
export function DeckEmptyState({
  onCreate,
  className,
}: DeckEmptyStateProps): React.JSX.Element {
  const loading = useDeckStore((s) => s.loading);
  const error = useDeckStore((s) => s.error);

  // 打开的编排（含切换后的状态清零）与顶栏入口共用 `lib/workspace-switch`，
  // 两处不再各写一份；错误仍由 deck-store 承载并在下方错误条呈现
  async function handleOpen(): Promise<void> {
    const dir = await window.api.system.selectDirectory();
    if (!dir) return;
    await switchWorkspace(dir);
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-8 px-6",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-display-md font-semibold tracking-tight text-ink">
          PPT Maker
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-ink-secondary">
          把一叠 16:9 页面图片变成 PowerPoint
          里真正可编辑的原生文本：批量跑去字与重建流水线，逐页复核文字，导出
          PPTX。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={onCreate} disabled={loading}>
          <Plus aria-hidden="true" className="size-3.5" />
          新建 Deck
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleOpen()}
          disabled={loading}
        >
          <FolderOpen aria-hidden="true" className="size-3.5" />
          打开已有 Deck
        </Button>
      </div>

      <div className="flex max-w-sm flex-col gap-1 text-center text-sm leading-relaxed text-ink-muted">
        <p>
          <strong className="font-medium text-ink-secondary">新建</strong> —
          页面可以来自图片目录、PDF 文档或内容规格，三种来源能混用
        </p>
        <p>
          <strong className="font-medium text-ink-secondary">打开</strong> —
          选择一个已有的 Deck 工作区目录
        </p>
      </div>

      {error !== null && error !== "" && (
        <p className="rounded-sm bg-state-failed/10 px-3 py-2 text-sm font-medium text-state-failed">
          {error}
        </p>
      )}
    </div>
  );
}

export type { DeckEmptyStateProps };
