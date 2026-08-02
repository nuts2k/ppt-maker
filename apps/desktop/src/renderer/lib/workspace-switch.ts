import { useActivityStore } from "@/stores/activity-store";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import { useSlideStore } from "@/stores/slide-store";
import { useSourceTaskStore } from "@/stores/source-task-store";
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
    /*
     * 把**新** deck 的路径交给日志层。
     *
     * 走到这一步 deck-store 已经落好新 deckPath，而 ConsolePage 的活动日志 effect
     * 可能已经据此发出了 load(新)——这次清零若把它一并作废，之后没有任何东西会
     * 再发一次，抽屉就永远停在「暂无记录」（磁盘上记录好好的，且不报错）。
     */
    useActivityStore.getState().reset(useDeckStore.getState().deckPath);
    /*
     * 建页任务的错误条与完成面板同样是 deck 级的：走查里换到另一个工作区后，
     * 上一个 deck 那句「PDF 中没有可用于建立页面的 16:9 页」还挂在新 deck 顶上。
     */
    useSourceTaskStore.getState().reset();
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
