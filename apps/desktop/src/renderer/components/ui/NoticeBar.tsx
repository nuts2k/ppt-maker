import { cn } from "@/lib/utils";
import { STATUS_SPEC } from "./status-spec";

/**
 * 通知条 —— 横贯一栏的系统反馈（环境提示、阶段失败）。
 *
 * DESIGN.md 没有模态语言，这类反馈一律走条形：贴在所属区域的边界上，
 * 不阻断操作，右侧带动作。
 *
 * 收进基座的**只有外壳**：上边界 + 底色 + 内边距。内容结构差别很大——环境提示条
 * 是「标题 + 逐条清单 + 建议」，阶段错误条是「图标 + 单行摘要 + 动作 + 可展开详情」，
 * 硬合成一个组件会得到一堆互斥的可选 props。
 *
 * 真正需要单源的是 **level → 底色** 这个映射：两处各写一遍 `bg-state-failed/10`
 * 时，下次新增第三条通知就只能靠翻代码猜该用哪个 `/10`。这里直接取
 * `STATUS_SPEC[...].wash`，与状态点、状态徽标共用同一张表。
 */

/** 通知条只有这两档。completed / pending 这类常态不该做成横贯一栏的条。 */
export type NoticeLevel = "failed" | "stale";

export interface NoticeBarProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly level: NoticeLevel;
}

export function NoticeBar({
  level,
  className,
  children,
  ...rest
}: NoticeBarProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "border-t border-hairline px-6 py-3",
        STATUS_SPEC[level].wash,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
