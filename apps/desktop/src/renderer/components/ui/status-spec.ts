import { Check, CircleX, Loader, TriangleAlert } from "lucide-react";
import type { ComponentType } from "react";
// 与 lib/stage-view.ts、stores/todo-queue.ts 一致：本文件用相对 `.js` 导入而非
// `@/` 别名，以便同时被 renderer（vite）与测试（vitest + tsconfig.node，NodeNext
// 解析且不含 `@/*` 映射）消费。改成别名会让 test/ui-design-rules 直接失去类型。
import {
  STAGE_STATUS_TEXT,
  type StageViewStatus,
} from "../../lib/stage-view.js";
import { cn } from "../../lib/utils.js";

/**
 * 状态呈现表 —— `StatusDot` 与 `StatusChip` 的唯一来源。
 *
 * **组件内不得自行拼状态色**（DESIGN.md `Components · Status`）：轨道、待办队列、
 * 活动日志三处若各拼一份，迟早各说各话。同一件事在多处展示时必须同源，见
 * `.trellis/spec/frontend/state-management.md`。
 *
 * ## 核心规则：有颜色 = 要你管
 *
 * 完成是常态 —— 一叠 20–50 页里绝大多数处于完成态。用饱和色标注常态，等于把最强的
 * 视觉手段给了最不需要注意的信息。上一版用深绿标完成，9 个绿点满屏是全局最大噪音源。
 *
 * 于是 completed / pending 走中性灰，饱和色只留给 running / stale / failed 这三个
 * 需要用户动作的状态。一屏扫过去，**有颜色的地方就是要你管的地方**。
 *
 * ## A3：状态不能只靠颜色区分
 *
 * 每个状态同时携带**颜色 + 形状 + 文字**：completed 实心圆 / pending 空心圆
 * （同为中性，靠填充与否区分）、stale 三角、failed 方块、running 带脉冲的圆。
 * 因此灰度截图与色弱条件下五态均可分辨（PRD AC9）。
 *
 * 中性档用 `border`（#8c8c8c，对 canvas 3.36:1）而非更淡的 `hairline`：
 * 安静不等于看不见，点位仍须满足 WCAG 1.4.11 的 3:1。
 */

export interface StatusSpec {
  /** 点的形状与配色 */
  readonly dot: string;
  /** chip 的文字色 */
  readonly text: string;
  /** chip 的底色 */
  readonly wash: string;
  readonly icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** 转引自 STAGE_STATUS_TEXT —— 文案只有一个来源，此处不另写 */
  readonly label: string;
}

/** 三角形，与圆/方块在小尺寸下也能区分 */
const TRIANGLE = "[clip-path:polygon(50%_0%,100%_100%,0%_100%)]";

export const STATUS_SPEC: Readonly<Record<StageViewStatus, StatusSpec>> = {
  // ── 常态：中性，安静 ────────────────────────────────────────
  completed: {
    dot: "rounded-full bg-border",
    text: "text-ink-secondary",
    wash: "bg-surface",
    icon: Check,
    label: STAGE_STATUS_TEXT.completed,
  },
  pending: {
    // 空心：与 completed 同色，靠「没填满」表达尚未发生
    dot: "rounded-full border-[1.5px] border-border bg-canvas",
    text: "text-ink-muted",
    wash: "bg-surface",
    icon: Loader,
    label: STAGE_STATUS_TEXT.pending,
  },

  // ── 需要动作：给颜色 ────────────────────────────────────────
  running: {
    // 减弱动效下脉冲被全局兜底压成静止，此时补一圈静态光环保住可辨识度
    dot: cn(
      "rounded-full bg-state-running",
      "animate-pulse motion-reduce:animate-none",
      "motion-reduce:ring-2 motion-reduce:ring-state-running/40",
    ),
    text: "text-state-running",
    wash: "bg-state-running/10",
    icon: Loader,
    label: STAGE_STATUS_TEXT.running,
  },
  stale: {
    dot: cn("bg-state-stale", TRIANGLE),
    text: "text-state-stale",
    wash: "bg-state-stale/10",
    // 三角 + 警示图标，与 failed 的方块 + 叉号在灰度下也分得开。
    // 文案取自 STAGE_STATUS_TEXT，那里已约定 stale 写「上游已变更」而非「失败」。
    icon: TriangleAlert,
    label: STAGE_STATUS_TEXT.stale,
  },
  failed: {
    dot: "rounded-xs bg-state-failed",
    text: "text-state-failed",
    wash: "bg-state-failed/10",
    icon: CircleX,
    label: STAGE_STATUS_TEXT.failed,
  },
  interrupted: {
    dot: "rounded-xs bg-state-failed",
    text: "text-state-failed",
    wash: "bg-state-failed/10",
    icon: CircleX,
    label: STAGE_STATUS_TEXT.interrupted,
  },
};

export const STATUS_DOT_SIZE = { sm: "size-2.5", md: "size-3.5" } as const;
