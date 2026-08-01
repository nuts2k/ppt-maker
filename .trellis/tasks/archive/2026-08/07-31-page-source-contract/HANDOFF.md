# 会话交接：子任务① 实现完毕，剩两项验证

写于 2026-08-01 会话结束时。工作区干净，6 个提交全部落在 `main`，**未 push**。

## 立刻做这一步

新会话的 Trellis 活动任务按会话 id 绑定，换会话后不会自动指向。先重新指向：

```bash
python3 ./.trellis/scripts/task.py current --source
```

若不是 `.trellis/tasks/07-31-page-source-contract`，执行：

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/07-31-page-source-contract
```

**不要重新规划**。`prd.md` / `design.md` / `implement.md` 三份齐备且已随实现修订过。

## 当前状态

| 项 | 状态 |
|---|---|
| 父任务 `07-31-page-sources-and-content-generation` | `in_progress`，阶段一（ROADMAP 对齐）已完成 |
| 子任务① `07-31-page-source-contract` | `in_progress`，实现五个阶段全部完成 |
| 子任务②③④ | **尚未创建** |
| 测试 | 550 项全绿；`pnpm typecheck`、`pnpm format:check` 通过 |
| 代码改动 | 已全部提交，工作区 clean |

提交序列（`main`）：

```
3a62992 docs(roadmap): M5 范围对齐——策划拆为 M6，来源交付物拆四项
e522b7f feat(core): 页面来源契约与 accept-source 闸门，旧工作区零迁移
57c814d feat(cli): 源图确认闸门落地，generated 页停在人工确认
0bbc69a feat(cli): 换源操作，slide 层动作 + deck 层按页寻址
d4083be feat(desktop): 换源入口，并修正换源后仍显示旧源图
b4bcf18 docs(spec): 固化来源契约、零迁移铁律与三闸门口径
```

## 只剩两件事（子任务①归档前）

### 1. B9 桌面端真机走查

```bash
pnpm --filter @ppt-maker/desktop dev     # 需要时加 REMOTE_DEBUGGING_PORT=9222
```

要确认四点：

- 阶段轨道最前面出现「确认源图」节点，`imported` 页显示为已完成
- 工具栏的「换源」按钮（ghost 权重，在「保存」左边）能拉起系统选图框
- 二次确认框里「保留已确认的文字块」**默认不勾**
- 换源后界面立刻刷新：预览换成新图（不是旧图）、复核稿清空、卡片阶段状态转 stale

走查工作区不要用 `~/test/ppttest-walkthrough-E1`（继续跑会烧 gpt-image-2）。
可以复制 `scratchpad/legacy-walk/deck`——它已是走查过的两页 deck，page-02 被手工改成
`generated` 且已确认过一次。

### 2. B2/B3 含云调用的完整链路

本轮**没跑**：`deck run` 全链路与 `deck export --strict` 需要 OpenAI 调用。
已验证的只是旧 deck 上 `slide ocr` / `slide review` 可继续、写操作时新字段自然落盘。
`prd.md` 的 B2/B3 标的是 `[~]`（部分验证），不要当成已通过。

跑之前确认 `.env` 里有 `OPENAI_API_KEY`，并按既有约定显式加
`--confirm-api --confirm-upload`。

## 五个必须带进下一会话的判断

这些是本轮代价最高的推理，重述以免在子任务②③④ 里被推翻。

**1. 归一化必须排在 `parse` 之前**（`apps/cli/src/slide/workspace.ts` 的 `loadSlideWorkspace`）。
写反了 `superRefine` 会先报「缺少阶段状态：accept-source」，M3/M4 的每个工作区都加载失败。
连带两处：`SHA256_PATTERN` 已从 `workspace-contracts.ts` 下沉到 `constants.ts`（否则
`source-contracts` 与它循环导入）；`config` 改为先于 manifest 解析（归一化要用
`sourceImagePath`），`configPath` 从未校验的原始对象里取。

**2. 当前源图只认 `sourceImageAssetId`**。换源保留旧图资产供追溯，`assets` 里会有多条
`source_image`。本轮已修 `slide:load-image` 与 `save-review` 两处按 role 取首条的读法
（`currentSourceImageAsset`）。**②③④ 新增任何读源图的地方都要用它**，按 role 取会拿到旧图。

**3. 闸门靠 core 兜底**。`ocr` 依赖 `accept-source`，`assertStageDependenciesCompleted`
因此对 CLI 与桌面端同时生效。但 `run --from` 必须在**循环外**先检查闸门——只按序判定时
`run --from ocr` 会绕过它、改由依赖守卫抛错，把「等人确认」误报成「执行失败」。

**4. 自动放行不写 `accepted.json`**。判据就是磁盘上这个文件在不在。
来源判定统一走 core 的 `requiresSourceAcceptance`，禁止在消费方各写一遍 `kind === "generated"`。

**5. 换源时来源重判必须排在失效之后**。`invalidateStageAndDownstream` 会把
`accept-source` 一并转 stale，顺序颠倒会被覆盖回去。失效起点是 `accept-source` 而非
`init`——init 刚刚成功，标 stale 与事实相反。

## 对父任务契约的一处增补（已回写）

`accept-source` 写验收记录需要新的资产 role `source_acceptance`，父任务 `design.md` §5
的枚举表原先没列，已补上。②③ 要加的 `source_document` / `content_spec` /
`generation_prompt` 仍在表里待落地。

## 子任务①归档后的下一步

按父任务 `implement.md` 阶段二，②③ 可并行创建：

```bash
python3 ./.trellis/scripts/task.py create "PDF 抽取" --slug pdf-page-extraction \
  --parent 07-31-page-sources-and-content-generation
python3 ./.trellis/scripts/task.py create "图片生成" --slug spec-driven-generation \
  --parent 07-31-page-sources-and-content-generation
```

ROADMAP 的 M5 小节已写下这四个计划 slug（不带日期前缀），创建后目录名会带 `MM-DD`，
届时可回填实际目录名。

**子任务③ 的第一步必须是 RK1 实证**：实调 `images.generate` 验证能否直出 16:9
（2048×1152 或等比档位）。现有 `images.edit` 用的该尺寸走的是 SDK `(string & {})`
自由通道，不构成 generate 也支持的证据。**验证失败就停下回父任务**，裁剪自产图还是换
Provider 属产品决策，不得在实现里自行选择。
