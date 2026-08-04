import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MenuItem, Panel } from "@/components/ui";
import {
  runWorkspaceAction,
  type WorkspaceAction,
  workspaceMenuIntent,
  workspaceMenuItems,
} from "@/lib/workspace-menu";
import { switchWorkspace } from "@/lib/workspace-switch";
import { useDeckStore } from "@/stores/deck-store";
import { selectPlanningDirty, usePlanningStore } from "@/stores/planning-store";
import { useRunStore } from "@/stores/run-store";
import { useSlideStore } from "@/stores/slide-store";
import { useSourceTaskStore } from "@/stores/source-task-store";
import { useUIStore } from "@/stores/ui-store";

/**
 * 顶栏当前工作区块 + 切换下拉（PRD R1）。
 *
 * 打开与创建的入口原本只在欢迎空态里，一旦打开 deck 就再也找不到，换 deck 只能重启进程。
 * 这里把顶栏的名称/路径块本身变成入口——它已经是「当前工作区」的唯一指示物。
 *
 * 「新建 Deck…」只负责打开来源选择模态（M5 ④）：新建的来源有三档，这里直接开
 * 图片目录框会让另外两档在 deck 打开状态下彻底无路可走。
 *
 * 下拉形态抄 DoctorChip：绝对定位面板 + 点外关闭，不另起一套浮层机制。
 */

interface WorkspaceMenuProps {
  readonly name: string | null;
  readonly deckPath: string;
  /** 有未保存复核改动或规格草稿时上抛，由 TopNav 渲染确认条 */
  readonly onRequestConfirm: (action: WorkspaceAction) => void;
}

/**
 * 选目录并执行切换。导出给 TopNav 的确认条复用，保证「直接切」与「确认后切」
 * 走的是同一条链路——两处各写一份迟早会各说各话。
 */
export async function executeWorkspaceAction(
  action: WorkspaceAction,
): Promise<void> {
  try {
    await runWorkspaceAction(action, {
      selectDirectory: () => window.api.system.selectDirectory(),
      switchWorkspace,
      // 新建走来源选择模态（三档来源统一入口），不在这里开图片目录框
      openSourcePicker: () => {
        useUIStore.getState().backToConsole();
        useUIStore.getState().openSourcePicker("new");
      },
      openPlanning: () => useUIStore.getState().openPlanningForNewDeck(),
    });
  } catch {
    // 忽略：错误已写入 deck-store 并由现有错误条呈现（与 DeckEmptyState 同一约定）
  }
}

export function WorkspaceMenu({
  name,
  deckPath,
  onRequestConfirm,
}: WorkspaceMenuProps): React.JSX.Element {
  const pipelineRunning = useRunStore((s) => s.status) !== "idle";
  const sourceTaskRunning = useSourceTaskStore((s) => s.running);
  const deckLoading = useDeckStore((s) => s.loading);
  const running = pipelineRunning || sourceTaskRunning || deckLoading;
  const reviewDirty = useSlideStore((s) => s.dirty);
  const planningDirty = usePlanningStore(selectPlanningDirty);
  const dirty = reviewDirty || planningDirty;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 点击面板外部收起下拉
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      const node = rootRef.current;
      if (node && !node.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function handleSelect(action: WorkspaceAction): void {
    const intent = workspaceMenuIntent(action, { running, dirty });
    switch (intent.kind) {
      case "ignored":
        return;
      case "confirm":
        setOpen(false);
        onRequestConfirm(intent.action);
        return;
      case "proceed":
        setOpen(false);
        void executeWorkspaceAction(intent.action);
        return;
    }
  }

  const items = workspaceMenuItems(running);

  return (
    // 顶栏整条是 macOS hiddenInset 拖拽区，其中可交互元素必须显式 no-drag，
    // 否则点击被拖拽吞掉，表现为「点了没反应」。只标按钮与面板本身，
    // 名称右侧的空白留给拖拽，别把整条标题栏变成死区。
    <div className="relative flex min-w-0 flex-1" ref={rootRef}>
      {/*
        只显示 deck 名。完整路径降级为 title 提示——它长、无层级、且几乎从不需要读，
        却在旧实现里以近似标题的字号占着顶栏第二显眼的位置。
      */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={deckPath}
        onClick={() => setOpen((value) => !value)}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors duration-fast hover:bg-surface active:bg-surface-sunken"
      >
        <span className="truncate text-base font-semibold text-ink">
          {name ?? "未命名 Deck"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-muted"
        />
      </button>

      {open && (
        <Panel
          elevation="raised"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="absolute left-0 top-full z-popover mt-2 w-72 p-1"
        >
          {items.map((item) => (
            <MenuItem
              key={item.action}
              disabled={item.disabled}
              disabledReason={item.disabledReason}
              onClick={() => handleSelect(item.action)}
            >
              {item.label}
            </MenuItem>
          ))}

          {/* 禁用原因写在面板里而不是只挂 title：灰掉却不说为什么等同于没反应 */}
          {running && (
            <p className="px-3 py-2 text-sm leading-relaxed text-ink-muted">
              执行中不可切换，请先停止。
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

export type { WorkspaceMenuProps };
