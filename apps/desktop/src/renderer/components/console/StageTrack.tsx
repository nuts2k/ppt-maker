import {
  STAGE_DOT_CLASS,
  STAGE_STATUS_TEXT,
  type StageView,
} from "@/lib/stage-view";
import { cn } from "@/lib/utils";

/**
 * 阶段轨道 —— 9 个阶段点位横排、以 hairline 连接线串成一条流水线。
 *
 * 卡片（sm）与单页复核的 StageRail（md）共用同一视觉，唯一差异是点位直径，
 * 保证同一状态在两处的颜色语义完全一致（design.md 3.3 状态色唯一表）。
 * 点位配色一律取 `STAGE_DOT_CLASS`，组件内不得自行拼色。
 *
 * **纯展示，点位不可交互。** 曾经支持传 onStageClick 做「从该阶段重跑」，
 * 但绝大多数点位重跑没有意义，可点击面积远大于有意义的动作面积（见 StageRail 注释）。
 */

interface StageTrackProps {
  views: readonly StageView[];
  /** sm = 8px 点（卡片内），md = 12px 点（单页复核） */
  size?: "sm" | "md";
}

export function StageTrack({
  views,
  size = "sm",
}: StageTrackProps): React.JSX.Element {
  const dotSize = size === "md" ? "h-3 w-3" : "h-2 w-2";
  const dotBase = cn("shrink-0 rounded-full border", dotSize);

  return (
    // 用原生 ul/li 承担 list/listitem 语义，避免在可交互点位上叠加 role 造成语义覆盖
    <ul className="flex w-full items-center">
      {views.map((view, index) => {
        const tooltip = `${view.label} · ${STAGE_STATUS_TEXT[view.status]}`;
        const dotClass = cn(dotBase, STAGE_DOT_CLASS[view.status]);

        return (
          <li
            key={view.stage}
            className={cn("flex items-center", index > 0 && "flex-1")}
          >
            {index > 0 && (
              // 连接线只是视觉，屏幕阅读器读点位即可
              <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
            )}
            <span title={tooltip} className={dotClass} />
          </li>
        );
      })}
    </ul>
  );
}
