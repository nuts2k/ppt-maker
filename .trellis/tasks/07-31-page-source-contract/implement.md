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

- [ ] 4.1 **先读 `DESIGN.md`**
- [x] 4.2 `shared/stages.ts` 与 `shared/gates.ts` 同步新阶段与新闸门文案
- [ ] 4.3 IPC handler：换源（直调 CLI 逻辑）
- [ ] 4.4 slide 详情视图的换源入口 + 二次确认 + 「保留已确认文字块」勾选框（默认不勾）
- [ ] 4.5 走查：`generated` 页停在源图确认并进待办队列；阶段轨道显示新节点

## 阶段五：验收与收口

- [ ] 5.1 逐条验证 `prd.md` 的 B1–B10
- [ ] 5.2 **B1/B2 用真实旧 deck 走查**，不接受仅凭 fixture 推断
- [ ] 5.3 更新 spec：`.trellis/spec/backend/contracts.md`
      - 「合并保留既有人工确认值」条目补写换源边界（父任务 design.md §4.4 已论证，逐条搬运）
      - 「链路收敛为双人工点」改为「最多三个人工点，源图确认按来源条件性激活」
      - `ArtifactAcceptance` 实例列表补 `accept-source`
- [ ] 5.4 回父任务 `design.md` §5 的枚举表补 `source_acceptance` role
- [ ] 5.5 提交并归档

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
