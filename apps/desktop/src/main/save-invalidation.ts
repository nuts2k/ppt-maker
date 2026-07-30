/**
 * 保存文本复核后要失效到哪一级。
 *
 * 缺陷背景：`slide:save-review` 此前只写盘，manifest 一动不动——用户改完分类保存，
 * 界面显示保存成功、轨道仍然全绿，但 mask 及下游产物根本没重做，最终 PPTX 还是旧的。
 *
 * 判据必须分粒度，**不得一律失效 mask**：`invalidateSlideStage` 的语义是强制重做而非
 * 幂等跳过，一律失效会让每一次保存都触发 clean 的付费图像调用。
 *
 * | 条件 | 失效目标 | 连带下游 |
 * |---|---|---|
 * | 旧文档不存在（首次保存） | null | — |
 * | `maskInvalidationProjection` 变了 | mask | clean / accept-clean / pptx / accept-pptx |
 * | 投影未变但文档内容不同 | pptx | accept-pptx |
 * | 完全相同 | null | — |
 *
 * 「投影变了」的口径来自 core 的 `maskInvalidationProjection`，与 `mask/run.ts` 的输入
 * 指纹同源——不得在此另写一份字段清单，两处口径分叉会让「我们判定不用重跑、mask 自己
 * 判定要重跑」同时成立。
 *
 * 「内容不同」直接比整份文档的序列化：`pptx/run.ts` 的输入指纹本就含整份文档的
 * sha256，此处不额外收窄，保持与 pptx 自身的判定一致。
 */

import {
  maskInvalidationProjection,
  type TextReviewDocument,
} from "@ppt-maker/core";

/** 保存复核后需要失效的阶段；null 表示无需失效任何阶段 */
export type SaveInvalidationTarget = "mask" | "pptx" | null;

export function decideInvalidation(
  previous: TextReviewDocument | null,
  next: TextReviewDocument,
): SaveInvalidationTarget {
  if (previous === null) return null;
  if (maskInvalidationProjection(previous) !== maskInvalidationProjection(next))
    return "mask";
  if (JSON.stringify(previous) !== JSON.stringify(next)) return "pptx";
  return null;
}
