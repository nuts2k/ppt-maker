import { useActivityStore } from "@/stores/activity-store";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import { useSlideStore } from "@/stores/slide-store";
import { useUIStore } from "@/stores/ui-store";
import {
  applyWorkspaceSwitch,
  type WorkspaceSwitchDeps,
  type WorkspaceTarget,
} from "./workspace-switch-core.js";

/**
 * 切换工作区的对外入口（顶栏下拉与欢迎空态共用）。
 *
 * 本模块只做「把编排规则绑到真实 store」这一件事，规则本身在
 * `workspace-switch-core.ts`（已单测）。
 *
 * 不在此处判断「执行中禁止切换」与「未保存改动确认」——那两条是 UI 层的守卫
 * （PRD R4 R5），到达这里就该无条件执行切换。
 */

const deps: WorkspaceSwitchDeps = {
  openDeck: (path) => useDeckStore.getState().openDeck(path),
  createDeck: (imagesDir, workspacePath) =>
    useDeckStore.getState().createDeck(imagesDir, workspacePath),

  // deck-store 由 openDeck / createDeck 自己套用新状态，无需再清
  resetOtherStores() {
    useRunStore.getState().reset();
    useSlideStore.getState().reset();
    useActivityStore.getState().reset();
    useUIStore.getState().reset();
  },
};

/**
 * 切换到另一个 deck 工作区。
 * 失败时保留当前 deck（不清任何 store），错误经 deck-store.error 呈现。
 */
export async function switchWorkspace(path: string): Promise<void> {
  await runSwitch({ kind: "open", path });
}

/** 从图片目录创建新工作区并切换过去。 */
export async function createWorkspaceFromImages(
  imagesDir: string,
): Promise<void> {
  await runSwitch({ kind: "create", imagesDir });
}

async function runSwitch(target: WorkspaceTarget): Promise<void> {
  try {
    await applyWorkspaceSwitch(deps, target);
  } catch {
    // 忽略：错误已写入 deck-store 的 error 字段并由错误条呈现，
    // 再抛出只会在调用方（多为 onClick 里的 void 调用）变成未处理拒绝
  }
}
