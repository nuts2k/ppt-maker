# 子任务①执行计划

顺序有意义：**契约与归一化必须先落地并通过旧 manifest 回归测试**，
否则后面每一步都建在一个会让既有工作区加载失败的基座上。

## 阶段一：契约与零迁移（准入关卡）

- [x] 1.1 新建 `packages/core/src/source-contracts.ts`：`SlideSourceSchema` 三分支判别联合、
      `requiresSourceAcceptance`、`SlideSourceDraft` + `materializeSource`，从 `index.ts` 导出
- [x] 1.2 `workspace-contracts.ts`：`SlideStageSchema` 追加 `accept-source`；
      `ArtifactAcceptanceSchema.stage` 追加 `accept-source`；
      `WorkspaceAssetSchema.role` 追加 `source_acceptance`；
      `SlideWorkspaceManifestSchema` 增 `source` 字段（schema 层必填）
- [x] 1.3 `stage-graph.ts`：`STAGE_DEPENDENCIES` 加 `"accept-source": ["init"]`，
      `ocr` 依赖改为 `["accept-source"]`；`createInitialStageStates` 增 `preCompleted` 参数
- [x] 1.4 core 新增 `normalizeSlideManifest`（`manifest-normalize.ts`，作用于 parse 前的原始对象）
- [x] 1.5 `apps/cli/src/slide/workspace.ts`：`loadSlideWorkspace` 在 `parse` **之前**调归一化；
      `createSlideWorkspace` 写入 `source` 并按来源决定闸门初始状态
- [x] 1.6 **旧 manifest 加载回归测试**（design §10 第一条）：
      `apps/cli/test/legacy-manifest.test.ts` 5 项 + `packages/core/test/manifest-normalize.test.ts` 5 项

验证：全部通过（527 测试、typecheck、biome）。1.6 不通过不得进入阶段二。

> 实测补充：`SHA256_PATTERN` 原定义在 `workspace-contracts.ts`，而它要反过来依赖
> `source-contracts.ts`，形成循环导入。已下沉到 `constants.ts`，对外导出路径不变。
> 归一化前需要 `config.sourceImagePath`，故 config 改为先于 manifest 解析，
> `configPath` 从未校验的原始对象里取（parse 正是会失败的那一步）。

## 阶段二：确认闸门

- [x] 2.1 `createSlideWorkspace` 写入 `source`（`imported`）并按 `requiresSourceAcceptance`
      决定 `accept-source` 初始状态；自动放行时追加 `auto-source-trust` attempt，
      **不写** `accepted.json`
- [x] 2.2 新建 `apps/cli/src/slide/accept-source.ts`（人工确认，照 `clean/accept.ts` 结构）
- [x] 2.3 CLI 注册 `slide accept-source`
- [x] 2.4 `run-from.ts`：`RUN_SEQUENCE` 插入 `accept-source`，新增 `gate: "source"` 分支，
      扩展 `RunFromResult.gate` 联合类型
- [x] 2.5 测试：自动放行页无 `accepted.json`、`generated` 页被 `ocr` 守卫拒绝、
      人工确认后链路恢复

## 阶段三：换源

- [x] 3.1 `apps/cli/src/slide/replace-source.ts`，按 design §6 的七步序列（注意第 6/7 步顺序）
- [x] 3.2 `text_review` / `review_validation` 归档（design §4），`--keep-review` 时跳过归档
- [x] 3.3 `apps/cli/src/deck/replace-source.ts` 薄包装 + CLI 注册两条命令
- [x] 3.4 测试：失效范围、资产悬空检查、`--keep-review`、deck 内其它页零变化

## 阶段四：桌面端

- [x] 4.1 **先读 `DESIGN.md`**
- [x] 4.2 `shared/stages.ts` 与 `shared/gates.ts` 同步新阶段与新闸门文案
- [x] 4.3 IPC handler：换源（直调 CLI 逻辑）
- [x] 4.4 slide 详情视图的换源入口 + 二次确认 + 「保留已确认文字块」勾选框（默认不勾）
- [x] 4.5 **真机走查（2026-08-01，CDP）**：阶段轨道显示新节点 ✅；`generated` 页停在源图确认 ✅；
      但暴露两个缺口，见 4.6 / 4.7
- [x] 4.6 待办队列新增「待确认源图」组：判据取耐久层 `accept-source` 非 `completed`
      （`lib/accept-gate.ts` 的 `awaitingSourceConfirm`，与单页入口同源），
      `GROUP_ORDER` 排在 `failed` 之后。控制台「待处理」筛选同源于 `deriveTodoQueue`，
      改一处两处生效。原 design §7 「新 gate 自动进队列」的断言已在该文件就地更正
- [x] 4.7 桌面端「确认源图」入口：`slide:accept-source` IPC（直调 CLI `runAcceptSource`）、
      preload / `channels.ts` 的 `acceptSource`、工具栏 secondary 按钮（primary 归「运行此页」）、
      详情页常驻提示条（停在源图确认时可见，不可关闭）

## 阶段五：验收与收口

- [x] 5.1 逐条验证 `prd.md` 的 B1–B10
- [x] 5.2 **B1/B2 用真实旧 deck 走查**，不接受仅凭 fixture 推断
- [x] 5.3 更新 spec：`.trellis/spec/backend/contracts.md`
      - 「合并保留既有人工确认值」条目补写换源边界（父任务 design.md §4.4 已论证，逐条搬运）
      - 「链路收敛为双人工点」改为「最多三个人工点，源图确认按来源条件性激活」
      - `ArtifactAcceptance` 实例列表补 `accept-source`
- [x] 5.4 回父任务 `design.md` §5 的枚举表补 `source_acceptance` role
- [x] 5.5 **修复：真实旧 deck 上换源必然失败**（2026-08-01，B2/B3 云链路走查时暴露）

      根因：`archiveReviewArtifacts` 在 `for (const asset of assets)` 里对**每一条**匹配的资产
      各 `rename` 一次，而 `review` 与 `assist-review` 各往 `stages/review/text-blocks.json`
      写过一次，manifest 里因此有两条 `text_review` 指向同一路径 → 第二次 rename ENOENT。
      跑完正常链路的页全部中招；测试与走查 deck 都只造了一条 `text_review`，故全绿而漏掉。

      连带：失败后新源图已复制、复核稿已搬进归档目录，manifest 却因原子写保护未更新，
      磁盘上留下资产悬空（B6 明令禁止的状态）。

      改法：① 归档按**路径**去重，一个文件只搬一次，所有引用它的资产记录一并改指归档路径
      （`text_review` 保留原 id、`review_validation` 换 `-archived-<attemptId>` 的既有约定不变）；
      ② 归档中途失败先把已搬的文件搬回原处再抛；
      ③ 归档移到写盘前一步，`config` / `manifest` 写入失败时回滚归档并把 config 写回旧源图。
      不引入通用事务框架，就近处理。

      测试：`apps/cli/test/replace-source.test.ts` 新增 3 例（多资产同路径、归档中途失败、
      manifest 写入失败），并对三处改动各做过一次变异验证（去掉即转红）。
      真实 deck 副本 `~/test/ppttest-archive-fix` 实跑通过。

- [x] 5.6 **修复：`deck status` 指错阶段**（2026-08-01，5.5 的实跑中顺带暴露）

      `accept-source` 插进 `SLIDE_STAGE_ORDER` 后，换源留下的形态是
      `init/accept-source completed + ocr 起全部 stale`，而 `computeProgress` 把
      「最后一个已完成阶段」（= accept-source）配上「它下一个阶段的失败态」，
      报出 `失败: page-01 (accept-source)`——指着一个 completed 的阶段，且正是本子任务
      新增的那个。换源是高频路径，每次都触发，观感上像新阶段坏了。

      改法：判据下沉到 core 的 `findBlockingStage`（`stage-graph.ts`），与桌面端
      `blockingStageView` 同一口径（真失败优先、其次失效）；`DeckSlideStatus` 拆出
      `blockingStage` 字段，`currentStage` 保留进度语义不变（桌面端经 IPC 消费它）。
      顺带修两处同源缺陷：① 失败阶段与最后一个已完成阶段之间夹 pending 时旧口径漏报；
      ② 已验收的页被上游作废时按「进度靠后」整页跳过。

      另修一处同因回归：`accept-source` 自动放行后 `currentStage` 不再是 `init`，
      于是刚建好一步没跑的 deck 每页都被报成「进行中」，`未开始` 计数恒为 0。
      判据改为「进度是否越过源图确认闸门」（`hasStarted`）。

      测试：`packages/core/test/stage-graph.test.ts` +7、`apps/cli/test/deck-status.test.ts`
      新建 6 例；三处改动各做过一次变异验证。真实 deck 上 `deck status` 前后对照：
      旧 `失败: page-01 (assist-review)`（该阶段 completed）→ 新 `失败: page-01 (mask)`。

- [x] 5.7 **修复：按裸 role 取首条资产，换源后取到归档那条**（2026-08-01，B2/B3 云链路实证）

      换过源的页跑 mask 必被拦：`text-blocks.json 在校验后已改动，请重新运行 validate-review`，
      而磁盘上每一处指纹都对得上，重跑 validate-review 也不解决。
      根因是 `mask/run.ts` 按裸 `role === "review_validation"` 取**首条**——换源归档后
      assets 里有两条，归档那条排在前面，它记的 `documentSha256` 是换源前旧复核稿的，
      与当前复核文件必然不等。5.5 保留的「归档时给 validation 换 id」约定本身是对的，
      但它让 `mask/run.ts` 里 `?? "asset-review-validation"` 这个 fallback 失效，
      两处要一起看。

      改法：`findCurrentValidationAsset` 用固定当前路径（`VALIDATION_OUTPUT_PATH`）判定，
      并让 `assertReviewValidated` 直接返回该资产——原来两处各查一次正是缺陷来源。
      `report/run.ts` 的 `ocr_result` 改用同文件既有的 `currentSuccessAsset`（按成功 attempt）。
      **未选**「给归档资产换 role」那条路：要动 `SlideAssetRoleSchema` 与父任务 §5 的 role 表、
      波及 ②③④；而归档件在语义上确实还是一份 `review_validation`，区分它的是「不是当前那份」，
      路径判定正对着这层含义。

      波及面已逐条复核：`pptx/run.ts`、`clean/accept.ts`、`clean/run.ts:149`、`assist-review.ts`、
      `slide/ocr.ts`、`mask/run.ts` 的 ocr_result、`replace-source.ts` 都已用 attemptId 或 path 约束；
      `mask`/`mask_record`/`pptx`/`pptx_check`/`*_acceptance` 均为固定 id 且写入时按 id 替换，单条；
      `deck/export.ts`、`validate-review.ts` 走 `sourceImageAssetId` / 固定资产 id。均无需改。

      测试：`slide-mask.test.ts` +1（真实走一遍 换源 → 重建复核链路 → mask，并前置断言归档那条
      确实排在当前之前）、`slide-run-report.test.ts` +1（多轮 ocr_result 取当前那轮）；
      两处各做过一次变异验证。真实 deck 副本 `~/test/ppttest-mask-fix` 前后对照：
      旧代码 `错误：text-blocks.json 在校验后已改动`（exit 1）→ 新代码输出 mask.png、掩盖像素 190991。

      > 顺带记录，未做：`stages/review/text-blocks.json` 这个字面量在 CLI 里有 11 处各写一份
      > （10 个文件）。本次只在 `mask/run.ts` 补了同风格的 `VALIDATION_OUTPUT_PATH` 局部常量，
      > 集中到单一来源是一次独立的机械清理，不混进缺陷修复。

- [x] 5.8 **修复：换源不清理旧的源图验收记录**（2026-08-01 桌面端走查实证）

      同一模式的第四例，打穿的是本子任务自己立的判据。page-02 先人工确认源图、再换图，
      换完 `accepted.json` 与 `source_acceptance` 资产原地不动，记的还是
      `asset-source-image-2`，而当前源图已是 `-3`；本次实际放行是 `auto-source-trust`。
      于是 B5 的判据「自动放行不写 `accepted.json`，判据就是这个文件在不在」不再成立；
      更危险的一格是换成 `generated`——闸门转 pending 而旧记录仍在，等于对一张没人看过的
      图声称「已确认」。`assertWorkspaceAssetIntegrity` 查不出来：文件在、哈希也对，
      错的是它描述的对象已经不是当前源图。

      改法：把 `archiveReviewArtifacts` 一般化为 `archiveArtifacts(…, targets)`，
      归档目标用 `{role, path, renameId}` 描述（`path` 是当前产物的固定路径——判据必须是
      路径而非裸 role，5.7 已实证同类缺陷）。归档路径统一为
      `<dirname>/archived/<initAttemptId>/<basename>`，复核件与验收记录同形状。
      `source_acceptance` **无条件**归档，不受 `--keep-review` 影响：那个开关保的是文字
      复核的人工劳动（对新图仍有参考价值、走 IoU 对齐），而「上一张图我看过了」对新图
      根本不成立。回滚与多资产同路径去重沿用 5.5 的机制，一次调用覆盖全部归档目标。

      测试：`replace-source.test.ts` +4（换成 imported 后旧记录不冒充当前验收、换成
      generated 后不存在可被误读为「已确认」的当前记录、`--keep-review` 下验收记录照样
      归档、此前自动放行的页无记录可归档）；两处变异验证（完全不归档 → 3 例红；
      仅 `--keep-review` 分支不归档 → 1 例红）。

      **同批调整 `deck status` 的「未开始」判据**（5.6 的后续，lead 真机反馈）：
      5.6 用「进度是否越过源图确认闸门」，副作用是换过源、下游全 stale 的页被算进「未开始」。
      判据改为「闸门之后有没有阶段脱离 `pending`」并落成 `DeckSlideStatus.started` 字段
      （摘要与列表同源取值，不各写一份）。取「非 pending」而非「有成功 attempt」，
      是因为正跑第一轮 OCR 的页（`running`、尚无成功记录）显然动过了；而 `pending` 之外
      每一种状态都蕴含跑过一次（`invalidateStageAndDownstream` 跳过 `pending`）。
      **失效不等于没跑过**——这类页归「进行中」，并由 `blockingStage` 在失败列表单独指名。
      两个方向都上了锁：退回按位置判断 → 换源用例红；放松到「非 init」→ 新建 deck 用例红。

- [x] 5.9 提交并归档（2026-08-01，4 个提交，未 push）

      `893aa9c` fix(core,cli) 阶段阻塞判据下沉 core
      `cde54b5` fix(cli) 换源路径三个必现缺陷
      `e5da82f` feat(desktop) 源图确认入口与待办队列组
      `b15ca8b` docs(spec,task) 多代资产选取契约与验收覆盖教训，B1–B10 全部通过

      准入实测：`pnpm format:check` 203 files no fixes、`pnpm typecheck` 三包 Done、
      `pnpm -r build` 三包 Done、`pnpm test` **576 项全绿**（core 90 + desktop 359 + cli 127）。

## 验证命令

```bash
pnpm -r build       # core 必须先 build，桌面端与 CLI 依赖其产物
pnpm format:check   # biome（本仓库没有 lint 脚本）
pnpm typecheck
pnpm test
```

## 回滚点

- **阶段一是唯一的高风险点**。若归一化被证明无法在不升版本的前提下让旧 manifest 通过校验，
  停止实现，回父任务重新考虑 `accept-source` 的落地形式（父任务 RK4 已写明这条出口）。
  在此之前不要开始阶段二，避免返工面扩大。
- 阶段二至四各自独立可回退：`git revert` 单个提交不会破坏前序阶段。
