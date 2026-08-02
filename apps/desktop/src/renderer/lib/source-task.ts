import { useActivityStore } from "@/stores/activity-store";
import { useDeckStore } from "@/stores/deck-store";
import {
  installSourceTaskDeps,
  useSourceTaskStore,
} from "@/stores/source-task-store";
import type {
  SourceTaskRequest,
  SourceTaskResult,
} from "../../main/ipc/channels.js";
import type { SourceTaskTarget } from "./source-task-core.js";
import { switchWorkspace } from "./workspace-switch.js";

/**
 * 建页任务的对外入口（来源选择界面、审片视图的「重新生成」共用）。
 *
 * 与 `workspace-switch.ts` 同一形状：本模块只做「把编排规则绑到真实 store」，
 * 规则本身在 `source-task-core.ts`（已单测，含竞态守卫）。
 */
installSourceTaskDeps({
  start: (deckPath, request) =>
    window.api.deck.sourceTaskStart(deckPath, request),
  currentDeckPath: () => useDeckStore.getState().deckPath,
  refreshStatus: () => useDeckStore.getState().refreshStatus(),
  switchWorkspace: (path) => switchWorkspace(path),
  async reloadActivity() {
    const deckPath = useDeckStore.getState().deckPath;
    if (deckPath === null) return;
    // 日志是旁路能力：拉不到不该把整条建页任务判成失败
    await useActivityStore
      .getState()
      .load(deckPath)
      .catch(() => undefined);
  },
  onResult: (result) => useSourceTaskStore.setState({ lastResult: result }),
  onError: (message) => useSourceTaskStore.setState({ error: message }),
});

export async function startSourceTask(
  target: SourceTaskTarget,
  request: SourceTaskRequest,
): Promise<SourceTaskResult | null> {
  return useSourceTaskStore.getState().run(target, request);
}

export type { SourceTaskTarget };
