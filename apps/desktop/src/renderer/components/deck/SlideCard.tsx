import { useEffect, useState } from "react";
import { useUIStore } from "@/stores/ui-store";
import type { DeckStatusSlide } from "../../../main/ipc/channels.js";

interface SlideCardProps {
  slide: DeckStatusSlide;
}

// 阶段状态到徽标样式与文案的映射
interface StatusStyle {
  label: string;
  className: string;
}

const PENDING_STYLE: StatusStyle = {
  label: "未开始",
  className: "bg-surface-strong text-muted",
};

const STAGE_STATUS_STYLE: Record<string, StatusStyle> = {
  completed: { label: "已完成", className: "bg-green-50 text-success" },
  running: { label: "进行中", className: "bg-blue-50 text-info" },
  failed: { label: "失败", className: "bg-red-50 text-red-600" },
  interrupted: { label: "已中断", className: "bg-amber-50 text-amber-600" },
  stale: { label: "已过期", className: "bg-amber-50 text-amber-600" },
  pending: PENDING_STYLE,
};

// 从 workspacePath 提取页面名称（取路径最后一段）
function pageNameFromPath(workspacePath: string): string {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? workspacePath;
}

export function SlideCard({ slide }: SlideCardProps): React.JSX.Element {
  const selectSlide = useUIStore((s) => s.selectSlide);
  const setView = useUIStore((s) => s.setView);
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.slide
      .loadImage(slide.workspacePath, "source_image")
      .then((dataUrl) => {
        if (!cancelled) setThumbnail(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setThumbnail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slide.workspacePath]);

  const statusStyle = STAGE_STATUS_STYLE[slide.stageStatus] ?? PENDING_STYLE;
  const pageName = pageNameFromPath(slide.workspacePath);

  function handleClick(): void {
    selectSlide(slide.slideId);
    setView("slide");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`group flex flex-col overflow-hidden rounded-md border border-hairline bg-canvas text-left transition hover:border-border-strong hover:shadow-sm ${
        slide.removed ? "opacity-50" : ""
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-surface-soft">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={pageName}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted">
            无预览
          </div>
        )}
        {slide.removed && (
          <span className="absolute left-2 top-2 rounded-xs bg-surface-dark px-1.5 py-0.5 text-[10px] font-medium text-on-dark">
            已移除
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span
          className="truncate text-sm font-medium text-ink"
          title={pageName}
        >
          {pageName}
        </span>
        <span
          className={`shrink-0 rounded-xs px-1.5 py-0.5 text-[10px] font-medium ${statusStyle.className}`}
          title={`${slide.currentStage} · ${slide.stageStatus}`}
        >
          {statusStyle.label}
        </span>
      </div>
    </button>
  );
}
