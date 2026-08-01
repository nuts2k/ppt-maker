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

- [x] B1 M3/M4 时代的真实 deck（无 `source`、无 `accept-source`）直接 `deck status` 成功，
      每页来源显示 `imported`，`accept-source` 显示已完成，且**磁盘 manifest 未被读操作改写**。
- [x] B2 同一 deck 上继续处理，全程无迁移步骤。
      **已验证**：旧 deck 上直接跑 `slide ocr` + `slide review` 成功，写操作时新字段自然落盘，
      未被写入的另一页仍保持旧格式（证明不存在全局迁移）。
      **含云调用的完整链路已补跑（2026-08-01，`~/test/ppttest-archive-fix`，
      从 M3/M4 真实 deck `ppttest-2026-07-25` 复制）**：
      page-02 全程无 `source` 字段仍正常参与，`deck run` 走复用路径，最新 attempt
      仍停在 `2026-07-25`——**零云调用、零迁移**，既有成果一个字节没被推翻；
      page-01 真实跑通 `assist-review-005 | openai` 与 `clean-003 | clean | openai`
      （gpt-image-2 实调），`deck export --strict` 产出 3.1 MB PPTX，
      「2 页原生 + 0 页占位」，解包确认是可编辑文本（slide1 60 个文本运行、slide2 77 个）。
      **走查代劳处（如实记录）**：page-01 的文本复核是脚本批量标记 `reviewStatus`，
      不是逐块人工判断；最终验收由 `slide accept-final --by walkthrough-agent` 代记录，
      note 里写明「未在 PowerPoint for Mac 中实际打开检查」。两处均不影响本条要验的
      链路连通性与零迁移。
      **顺带发现（非本任务引入）**：page-02 的旧复核数据在当前 `review-validation-v2`
      规则下不合规（`block-045` 违反 `LAYOUT_TEXT_MUST_BE_MASKED`）。旧 deck 无需迁移即可
      继续处理，但复核数据可能被演进后的校验规则拦下——这是产品行为，不是契约问题。
- [x] B3 `imported` 页不在源图确认处停顿，人工点仍是两个。
      **已验证**：自动化测试确认 `run --from` 对自动放行页不返回 `source` 闸门；
      走查中旧 deck 的 imported 页 `ocr` / `review` 直接执行未停顿。
      **含云调用的完整链路已补跑（同 B2）**：page-01 全程只停两次——
      `review`(human-edit) 与 `accept-pptx`(manual)，`accept-source` 自动放行不停顿，
      没有出现第三个人工点。
- [x] B4 手工把某页 `source.kind` 改为 `generated` 并把 `accept-source` 置 `pending` 后，
      `slide run --from ocr` 因阶段依赖未完成而**拒绝执行**（不是跳过、不是静默通过）。
- [x] B5 对该页执行 `slide accept-source` 后链路恢复，且磁盘上出现 `accepted.json`；
      对 `imported` 页检查磁盘，`accept-source` 为 `completed` 但**无** `accepted.json`。
      **补充实证（2026-08-01 桌面端走查）**：这条判据在**换源场景下曾被陈旧记录打穿**。
      换源归档了复核成果却漏了 `source_acceptance`，于是一个对**上一张图**做的人工确认
      原地留在固定路径上：自动放行的页磁盘上有 `accepted.json`（判据的一半失效），
      换成 `generated` 后闸门未过而记录仍在（等于对一张没人看过的图声称「已确认」，
      更危险的一半）。已把 `source_acceptance` 纳入换源的归档序列，不受 `--keep-review`
      影响，见 `design.md` §6 第 5b 步与 `implement.md` 5.8。
      判据本身不变——恰恰因为判据是「文件在不在」，才必须保证换源时它被移走。
- [x] B6 `slide replace-source` 换一张新图后：`init` 仍 `completed`（并指向新 attempt），
      `ocr` 及其下游全部 `stale`，`stages/review/text-blocks.json` 不再存在于原路径，
      manifest 中无任何资产指向不存在的文件。
      `accept-source` 本身按**新来源**重判：换成 `generated` 保持未完成、换成
      `imported` / `extracted` 重新自动放行为 `completed`（这正是 S7 要的行为，
      与「下游失效」不冲突——闸门本身不是下游）。
      **补充实证（2026-08-01）**：初次判过 B6/B7 的 fixture 与走查 deck 每页只有**一条**
      `text_review` 资产，覆盖不足。真实 deck 上 `review` 与 `assist-review` 各写过一次复核稿，
      manifest 里有**两条** `text_review` 指向同一个 `stages/review/text-blocks.json`，
      归档时逐条 `rename` 第二次必然 ENOENT——**任何跑完正常链路的页都换不了源**，
      且失败后新源图已复制、复核稿已搬走而 manifest 未更新，正好落进 B6 明令禁止的资产悬空。
      已改为按路径搬一次、所有引用记录一并改指，并对搬运失败与写盘失败补了回滚。
      重新在真实 deck 副本（`~/test/ppttest-archive-fix`）上实跑通过：
      两条 `text_review` 均指向 `archived/init-002/text-blocks.json`、无悬空资产、
      page-02 manifest md5 仍为 `3f89837c2b0825ddc2399c72484606e6`。
      **第二处补充实证（同日）**：换源本身成功之后，该页跑 mask 又必被拦
      （`mask/run.ts` 按裸 role 取首条 `review_validation`，取到归档那条）。
      B6/B7 当初判过，是因为自动化测试只跑到换源为止、没有继续跑 mask——
      「换源成功」不等于「换源后链路能继续」。已修并在真实 deck 副本上验证，见
      `implement.md` 5.7。
- [x] B7 带 `--keep-review` 换源后，人工确认的块经 IoU 对齐保留下来。
      （同 B6 的补充实证：原判据也建立在单条 `text_review` 的 fixture 上。）
- [x] B8 deck 内换第 2 页的源：其余页的阶段状态、资产、验收记录**逐字节不变**。
- [x] B9 桌面端（2026-08-01 CDP 真机走查）：阶段轨道显示新阶段 ✅、`generated` 页停在源图确认 ✅、
      换源入口可用且默认清空复核成果 ✅。
      走查暴露两个缺口并已补齐：
      ① 停在源图确认的页不进待办队列（`deriveSlideItem` 只认 `validation-failed` /
      `human-edit` 两个会话 gate，`gate: "source"` 落空；刷新后该页被归入「未开始」）
      → 新增 `confirm-source` 组，判据取耐久层 `accept-source` 状态；
      ② 桌面端没有「确认源图」的执行入口，只能回 CLI
      → 新增 `slide:accept-source` IPC + 工具栏按钮 + 详情页常驻提示条。
      **复走查已完成（同日，重启 dev 加载新 main/preload）**：
      未跑过任何 run、刚打开 deck 的状态下，未确认页就出现在「待确认源图」组且
      「待处理」筛选同步收录——证明判据确实取自耐久层而非会话 gate；
      点「确认源图」后写出 `accepted.json`（provider `developer`，
      `artifactAssetId` 指向换源后的当前图 `asset-source-image-2` 而非旧图），
      轨道转 1/10、下一步变「文字识别」、该页正确出队。
      **二次确认框默认不勾由用户亲眼确认**（原生对话框既截不到也点不了：
      本机无屏幕录制与辅助访问权限）。
- [x] B10 `pnpm -r build`、`pnpm format:check`（本仓库无 lint 脚本）、`pnpm typecheck`、
      `pnpm test` 全绿，且新增旧 manifest 加载回归测试。
      （补完 B9 两个缺口与换源路径四个缺陷后为 **576 项**：core 90 + desktop 359 + cli 127，
      较子任务①主体完成时的 550 项净增 26。）

> 走查记录（2026-07-31，`scratchpad/legacy-walk`）：造 2 页 deck → 手工降级为 M3/M4 格式
> （删 `source`、删 `accept-source` 状态与 attempt）→ `deck status` 成功且 manifest 字节未变
> → `slide ocr` / `slide review` 可继续 → `deck replace-source page-01` 后 init 仍 completed、
> ocr/review 转 stale、复核稿归档到 `archived/init-002`、无资产悬空、page-02 字节未变
> → 手工把 page-02 改为 `generated` 未确认：`slide ocr` 被守卫拒绝、`run --from ocr` 报
> 「停在源图确认」→ `slide accept-source` 后写出 `accepted.json`（checklist 为空）并放行
> → 对 imported 页调 `accept-source` 被拒绝。

## 风险

- **头号风险（父任务 RK4）**：`accept-source` 加入 `SlideStage` 后，
  `SlideWorkspaceManifestSchema.superRefine` 的「所有阶段都必须有状态」校验会让旧 manifest
  **直接解析失败**。归一化必须在 `parse` **之前**作用于原始 JSON，否则永远走不到归一化。
  旧 manifest 加载回归测试是本任务的准入条件，不得延后。
- **绕过闸门**：若 `ocr` 的依赖守卫失效，`generated` 页会静默滑过确认。
  防线是 `assertStageDependenciesCompleted` 在 core 层，CLI 与桌面端共用同一条路径。
- **资产悬空**：清空 `text_review` 时删文件不删记录，会让 manifest 指向不存在的文件。
  见 `design.md` §4 的归档方案。
