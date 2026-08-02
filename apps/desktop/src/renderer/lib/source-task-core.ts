/**
 * 建页任务的编排规则（design §4.3）。
 *
 * 依赖全部由参数注入、不碰任何 store，是为了能在 node 环境直接单测——本编排唯一
 * 的要害是**竞态守卫**，而守卫失效的表现是「界面看着正常，数据是上一个工作区的」，
 * 完全静默。绑定真实 store 的薄壳见 `stores/source-task-store.ts`。
 *
 * ## 为什么这里必须有守卫
 *
 * 桌面端此前打开 deck 后 `deckPath` 一辈子不变。④ 加了「新建 deck」之后它成为
 * 可变维度，于是「请求发出 → 期间切换工作区 → 迟到响应到达」从不可触发变成常规
 * 路径（见 .trellis/spec/frontend/state-management.md「新增一个切换维度的能力」）。
 *
 * **失败路径同样要守**：迟到的失败若照写 error，错误条会指着一个用户已经离开的
 * 工作区。
 */

import type {
  SourceTaskRequest,
  SourceTaskResult,
} from "../../main/ipc/channels.js";
import { ipcErrorMessage } from "./ipc-error.js";

export interface SourceTaskDeps {
  /** 发起建页任务；失败时抛出 */
  start(
    deckPath: string,
    request: SourceTaskRequest,
  ): Promise<SourceTaskResult>;
  /** 响应到达时的当前工作区身份 */
  currentDeckPath(): string | null;
  /** 追加场景：任务结束后刷新当前 deck */
  refreshStatus(): Promise<void>;
  /** 新建场景：切到新建出来的 deck（内含状态清零） */
  switchWorkspace(path: string): Promise<void>;
  /**
   * 重新拉取当前 deck 的活动日志。
   *
   * main 在任务收尾时会写一条记录（抽取那条还带着报告路径），不重拉的话面板停在
   * 任务发起前的样子——抽取报告一关就再也找不回来了，而 E4 要的正是「不常驻版面，
   * 但也不能关了就找不到」。新建场景不必调它：`switchWorkspace` 换了 deckPath，
   * 活动日志由 ConsolePage 的 effect 整体重载。
   */
  reloadActivity(): Promise<void>;
  onResult(result: SourceTaskResult): void;
  onError(message: string): void;
}

/**
 * 「被互斥挡下」的理由，没被挡下则为 null。
 *
 * 判据单独拎出来是因为它落在两套既有呈现的缝里：完成面板与抽取报告都只认
 * `accepted`，错误条只认抛出来的异常，于是 `accepted: false` 谁都不管——
 * 表现是点完「追加页面」模态一关，界面纹丝不动，理由静静躺在 store 里
 * （走查实测，属 silent-failure-thinking-guide 的第一类）。
 */
export function sourceTaskBlockedReason(
  result: SourceTaskResult | null,
): string | null {
  if (result === null || result.accepted) return null;
  // 理由为空说明 main 没说清楚，这里也不替它编一句：给个兜底但不伪装成具体原因
  return result.message === "" ? "建页任务被挡下，未给出原因" : result.message;
}

export interface SourceTaskTarget {
  /** 目标 deck 目录：已存在则追加，不存在则由 CLI 侧的建页命令创建 */
  readonly deckPath: string;
  /**
   * 这是一次「新建」。
   *
   * 与「响应到达时 deckPath 是否变了」是两件事：新建时发起身份是 `null`
   * （或用户当时在看的另一个 deck），完成后要 `switchWorkspace` 过去；
   * 追加时发起身份就是目标 deck，完成后原地 `refreshStatus`。
   */
  readonly createNew: boolean;
}

/**
 * 执行一次建页任务。
 *
 * 返回 `null` 表示**结果被丢弃**（期间切换了工作区），调用方据此什么都不做——
 * 既不刷新也不报错。被互斥挡下（`accepted: false`）不是丢弃，它要照常报给用户。
 */
export async function runSourceTask(
  deps: SourceTaskDeps,
  target: SourceTaskTarget,
  request: SourceTaskRequest,
): Promise<SourceTaskResult | null> {
  // 发起那一刻的身份。新建场景下通常是 null（空态）或用户正看着的另一个 deck
  const origin = deps.currentDeckPath();

  let result: SourceTaskResult;
  try {
    result = await deps.start(target.deckPath, request);
  } catch (error) {
    if (deps.currentDeckPath() !== origin) return null;
    deps.onError(ipcErrorMessage(error));
    // 失败也写了活动记录（main 的 recordFailure），面板同样要跟上
    await deps.reloadActivity();
    return null;
  }

  if (deps.currentDeckPath() !== origin) return null;

  // 被互斥挡下时 main 没写任何记录，也没动 deck，什么都不用刷
  if (result.accepted) {
    if (target.createNew && result.deckPath !== null) {
      await deps.switchWorkspace(result.deckPath);
    } else {
      await deps.refreshStatus();
    }
    /*
     * 两条路都要重拉活动日志，新建也不例外。
     *
     * 「新建」并不保证换了 deck：落点是「来源文件同级 + 日期后缀」，同一天对同一份
     * 规格再点一次新建就落回同一个目录（CLI 照常对账跳过，见走查记录）。此时
     * `deckPath` 前后相同，ConsolePage 那条按 `deckPath` 触发的 effect 根本不会重跑，
     * 而切换编排已经把日志清空了——不显式重拉，抽屉就停在「暂无记录」。
     */
    await deps.reloadActivity();
  }

  /*
   * 结果**最后**才上报。
   *
   * 新建场景里 `switchWorkspace` 会把 deck 级的会话态整体清零，其中就包括本 store
   * 的 `lastResult`——先上报就会被这次清零顺手抹掉，表现是批量生成建出新 deck 后
   * 完成面板与它上面的「去确认」压根不出现（走查实测）。结果本就属于切换之后的那个
   * deck，放在最后既躲开清零，顺序上也更诚实。
   */
  deps.onResult(result);
  return result;
}
