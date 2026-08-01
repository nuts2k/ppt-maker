# 子任务①：页面来源契约与换源操作

父任务：`07-31-page-sources-and-content-generation`（M5）。
本任务是 M5 的**基座纵切**——②③④ 全部依赖它落地的契约。

## 目标

给每一页加上「这张图从哪来」这个维度，并让「换掉这张图」成为一等操作。
本任务不实现任何新来源（PDF 抽取归 ②、图片生成归 ③），只保证：
契约能表达三种来源、换源路径对三种来源统一、源图确认闸门按来源条件性激活、
既有工作区零迁移。

## 范围

在范围内：

- `SlideSource` 判别联合契约（三个分支的字段全部落地，即使 ②③ 尚未产生数据）
- `SlideWorkspaceManifest.source` 可选字段 + 加载期归一化
- `accept-source` 阶段：`SlideStage` 与 `ArtifactAcceptance.stage` 枚举扩展、阶段图依赖调整
- 自动放行（`imported`）与人工确认（`generated`）两条路径
- `replaceSlideSource`（slide 层）+ deck 层按页寻址包装
- 换源时 `text_review` 的默认清空与显式保留
- CLI：`slide accept-source`、`slide replace-source`、`deck replace-source`
- 桌面端：换源入口 + 阶段轨道容纳新阶段 + 闸门文案

不在范围内：

- PDF 抽取与图片生成（②③）；本任务只让 `ExtractedSource` / `GeneratedSource` **可被表达**
- 批量源图确认界面（④）；本任务只保证单页确认可用、批量执行时能正确停下并进待办队列
- 内容规格与规格漂移（③）

## 需求

- **S1 来源契约**：`SlideSource` 按 `kind` 判别联合，字段与父任务 `design.md` §2 逐字一致。
  三个分支共有 `recordedAt` 与 `attemptId`。成本与用量不进本契约。
- **S2 零迁移**：`SCHEMA_VERSION` / `workspaceVersion` / `deckVersion` 均不变。
  M3/M4 时代的 manifest（无 `source`、无 `accept-source` 状态）加载后即可继续处理并严格导出，
  无任何迁移步骤、无报错。
- **S3 归一化后内部必填**：业务代码读到的 `source` 永远非空，不出现散落的 `?? "imported"`。
  可选性只存在于磁盘 schema。
- **S4 源图确认闸门**：`accept-source` 依赖 `init`，`ocr` 依赖 `accept-source`。
  `generated` 页初始 `pending`，`imported` / `extracted` 初始 `completed`。
- **S5 自动放行不伪造人工痕迹**：自动放行的页 `accept-source` 为 `completed` 但**不写**
  `accepted.json`，事实记录在该阶段 attempt 的 `provider` 字段（`auto-source-trust`）。
- **S6 换源统一路径**：`replaceSlideSource` 与新图来源无关。执行序列见 `design.md` §3，
  失效起点为 `accept-source`（`init` 保持 `completed`），失效只作用于本页。
- **S7 换源后重新判定确认要求**：换源后 `accept-source` 按**新来源**重新定状态。
- **S8 人工复核成果处理**：默认换源后该页 `text_review` 不参与后续合并；
  提供显式保留选项。资产记录不得指向不存在的文件。
- **S9 CLI 与桌面端各有入口**：两侧走同一份 core / CLI 逻辑，不各写一份判断。

## 验收标准

- [ ] B1 M3/M4 时代的真实 deck（无 `source`、无 `accept-source`）直接 `deck status` 成功，
      每页来源显示 `imported`，`accept-source` 显示已完成，且**磁盘 manifest 未被读操作改写**。
- [ ] B2 同一 deck 上继续 `deck run` 并 `deck export --strict` 成功，全程无迁移步骤。
- [ ] B3 新建的 `imported` 页跑完整链路不在源图确认处停顿，人工点仍是两个。
- [ ] B4 手工把某页 `source.kind` 改为 `generated` 并把 `accept-source` 置 `pending` 后，
      `slide run --from ocr` 因阶段依赖未完成而**拒绝执行**（不是跳过、不是静默通过）。
- [ ] B5 对该页执行 `slide accept-source` 后链路恢复，且磁盘上出现 `accepted.json`；
      对 `imported` 页检查磁盘，`accept-source` 为 `completed` 但**无** `accepted.json`。
- [x] B6 `slide replace-source` 换一张新图后：`init` 仍 `completed`（并指向新 attempt），
      `ocr` 及其下游全部 `stale`，`stages/review/text-blocks.json` 不再存在于原路径，
      manifest 中无任何资产指向不存在的文件。
      `accept-source` 本身按**新来源**重判：换成 `generated` 保持未完成、换成
      `imported` / `extracted` 重新自动放行为 `completed`（这正是 S7 要的行为，
      与「下游失效」不冲突——闸门本身不是下游）。
- [ ] B7 带 `--keep-review` 换源后，人工确认的块经 IoU 对齐保留下来。
- [ ] B8 deck 内换第 2 页的源：其余页的阶段状态、资产、验收记录**逐字节不变**。
- [ ] B9 桌面端：阶段轨道显示新阶段、`generated` 页停在源图确认并进入待办队列、
      换源入口可用且默认清空复核成果（保留需主动勾选）。
- [ ] B10 `pnpm -r build / lint / typecheck / test` 全绿，且新增旧 manifest 加载回归测试。

## 风险

- **头号风险（父任务 RK4）**：`accept-source` 加入 `SlideStage` 后，
  `SlideWorkspaceManifestSchema.superRefine` 的「所有阶段都必须有状态」校验会让旧 manifest
  **直接解析失败**。归一化必须在 `parse` **之前**作用于原始 JSON，否则永远走不到归一化。
  旧 manifest 加载回归测试是本任务的准入条件，不得延后。
- **绕过闸门**：若 `ocr` 的依赖守卫失效，`generated` 页会静默滑过确认。
  防线是 `assertStageDependenciesCompleted` 在 core 层，CLI 与桌面端共用同一条路径。
- **资产悬空**：清空 `text_review` 时删文件不删记录，会让 manifest 指向不存在的文件。
  见 `design.md` §4 的归档方案。
