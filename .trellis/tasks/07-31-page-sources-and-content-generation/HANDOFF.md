# 会话交接：子任务① 已归档，②③ 待创建

写于 2026-08-01 会话结束时。工作区干净，5 个提交落在 `main`，**未 push**（领先远程 17 个）。

> 本文件替换了 2026-07-31 那版（当时父任务尚未启动）。阶段一与子任务① 都已完成，
> 那版描述的状态已全部作废。

## 立刻做这一步

Trellis 活动任务按会话 id 绑定，换会话不会自动指向。新会话先：

```bash
python3 ./.trellis/scripts/task.py current --source
```

若不是 `.trellis/tasks/07-31-page-sources-and-content-generation`，执行：

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/07-31-page-sources-and-content-generation
```

**不要重新规划父任务**。`prd.md` / `design.md` / `implement.md` 三份齐备且已随子任务① 的
实现修订过（§5 role 表、§6 换源序列各补过一处）。

## 当前状态

| 项 | 状态 |
|---|---|
| 父任务 | `in_progress`，阶段一（ROADMAP 对齐）完成，阶段二进行中 |
| 子任务① 页面来源契约与换源操作 | **已完成并归档** → `.trellis/tasks/archive/2026-08/07-31-page-source-contract/` |
| 子任务②③④ | **尚未创建** |
| 测试 | 576 项全绿（core 90 + desktop 359 + cli 127） |
| 代码改动 | 已全部提交，工作区 clean |

`main` 上本轮的 5 个提交：

```
893aa9c fix(core,cli): 阶段阻塞判据下沉 core，deck status 不再指错阶段
cde54b5 fix(cli): 换源路径三个必现缺陷，多代资产不再冒充当前产物
e5da82f feat(desktop): 源图确认入口与待办队列「待确认源图」组
b15ca8b docs(spec,task): 固化多代资产选取契约与验收覆盖教训，B1-B10 全部通过
（+ 1 个 task.py archive 的自动提交）
```

## 下一步：创建子任务②③

按 `implement.md` 阶段二，两者可并行创建（都只依赖① 的来源契约，彼此不依赖）：

```bash
python3 ./.trellis/scripts/task.py create "PDF 抽取" --slug pdf-page-extraction \
  --parent 07-31-page-sources-and-content-generation
python3 ./.trellis/scripts/task.py create "图片生成" --slug spec-driven-generation \
  --parent 07-31-page-sources-and-content-generation
```

ROADMAP 的 M5 小节写了这四个计划 slug（不带日期前缀），创建后目录名会带 `MM-DD`，
届时回填实际目录名。

**子任务③ 的第一步必须是 RK1 实证**：实调 `images.generate` 验证能否直出 16:9
（2048×1152 或等比档位）。现有 `images.edit` 用的该尺寸走的是 SDK `(string & {})`
自由通道（`openai-image.ts:52` 注释自陈无字面量校验），**不构成 generate 也支持的证据**。
**验证失败就停下回父任务**——裁剪自产图还是换 Provider 属产品决策，不得在实现里自行选择。
此时①② 已完成且不依赖③，可以只交付两种来源，M5 完成条件相应调整。

## ②③④ 动手前必读的两份 spec

这是子任务① 用六个缺陷换来的，**不读会原样重犯**：

1. `.trellis/spec/backend/contracts.md`〈多代资产与「当前产物」选取契约〉
2. `.trellis/spec/guides/verification-coverage-thinking-guide.md`

核心一句：**换源与阶段重跑会让同一 `role` 在 `assets` 里出现多代，
`assets.find(a => a.role === X)` 拿到的是上一代**——文件确实存在、哈希也对，
错的是它描述的对象已经不是当前那个，`assertWorkspaceAssetIntegrity` 查不出来。

②③ 会新增 `source_document` / `content_spec` / `generation_prompt` 三个 role
（父任务 `design.md` §5 枚举表里已列、待落地）。**这三个只要会被重新生成或替换，
就同样会有多代问题**，判据从下面三类里选，别写裸 `role`：

| 判据 | 适用 | 现成例子 |
|---|---|---|
| 显式指针 | 有「当前是哪个」概念的 | `sourceImageAssetId` / `currentSourceImageAsset` |
| 固定当前路径 | 有唯一固定落点的 | `findCurrentValidationAsset`（`mask/run.ts`） |
| 阶段最后一次成功 attempt | 每次 attempt 各出一份的 | `currentSuccessAsset`（`report/run.ts`） |

## 六个必须带进下一会话的判断

前五条来自子任务① 的实现，第六条来自它的验收。

**1. 归一化必须排在 `parse` 之前**（`apps/cli/src/slide/workspace.ts` 的 `loadSlideWorkspace`）。
写反了 `superRefine` 会先报「缺少阶段状态：accept-source」，M3/M4 的每个工作区都加载失败。
连带两处：`SHA256_PATTERN` 已从 `workspace-contracts.ts` 下沉到 `constants.ts`（否则
`source-contracts` 与它循环导入）；`config` 改为先于 manifest 解析（归一化要用
`sourceImagePath`），`configPath` 从未校验的原始对象里取。

**2. 当前源图只认 `sourceImageAssetId`**，见上一节——这条已推广成通用契约。

**3. 闸门靠 core 兜底**。`ocr` 依赖 `accept-source`，`assertStageDependenciesCompleted`
因此对 CLI 与桌面端同时生效。但 `run --from` 必须在**循环外**先检查闸门——只按序判定时
`run --from ocr` 会绕过它、改由依赖守卫抛错，把「等人确认」误报成「执行失败」。

**4. 自动放行不写 `accepted.json`**，判据就是磁盘上这个文件在不在。
来源判定统一走 core 的 `requiresSourceAcceptance`，禁止在消费方各写一遍 `kind === "generated"`。
**（2026-08-01 补）** 正因为判据是「文件在不在」，换源时必须把它移走——漏了这一步，
一份对上一张图的人工确认会留在固定路径上冒充当前验收。已修，见 `design.md` §6 第 5b 步。

**5. 换源时来源重判必须排在失效之后**。`invalidateStageAndDownstream` 会把
`accept-source` 一并转 stale，顺序颠倒会被覆盖回去。失效起点是 `accept-source` 而非
`init`——init 刚刚成功，标 stale 与事实相反。

**6.（新）验收止步于哪里，缺陷就藏在哪之后。**
B1–B10 曾在 550 项全绿 + 一次两页小 deck 走查后判过一轮，随后在真实 deck 上补跑含云调用
的完整链路，一次性又暴露四个缺陷、三个必现。不是判据写错，是判据从没在会出问题的形态上
跑过：fixture 每个 role 恰好一条（裸 `find` 碰巧也对）、测试止于「换源成功」不跑下游、
从没「先人工确认再换源」过。②③④ 的验收标准要照《验收覆盖思考指南》检查覆盖形状。

## 走查环境（②③④ 会再用到）

- **`~/test/ppttest-2026-07-25` 是基线**：两页、十阶段全 completed、**无 `source` 字段的
  M3/M4 旧格式**。验证兼容性一律从它复制，别在它本身上跑。
- **`~/test/ppttest-archive-fix` 是唯一跑完含云调用完整链路的 deck**：page-01 实调过
  openai 与 gpt-image-2，两页均已 accept-final，`~/test/b2-export-strict.pptx` 是它导出的
  （2 页原生、可编辑文本）。要复现完整链路优先用它。
- 换源走查用图在 `~/test/`：`new-source-flipped.png`（原图旋转 180°，换没换一眼可辨）、
  `back-to-normal.png`、`b2-newsource.png`。**放 `~/test/` 是因为 macOS 选图框够不到
  `/private/tmp`**，会话 scratchpad 里的图用户选不到。
- 桌面端走查开 `REMOTE_DEBUGGING_PORT=9222 pnpm --filter @ppt-maker/desktop dev`，
  用 CDP 连 `http://127.0.0.1:9222/json/list` 的 page 目标发 `Runtime.evaluate`。
  dev 模式下 `await import('/stores/deck-store.ts')` 拿到的就是界面正在用的那个 store，
  可直接 `openDeck(path)` 绕过「打开 Deck」的原生框。
  但 `window.api` 是 contextBridge 只读代理**stub 不掉**，且本机无屏幕录制与辅助访问权限
  （`screencapture` 与 `osascript` 都被拒），**原生对话框只能请用户亲自点**。
- `pnpm typecheck` 前必须先 `pnpm --filter @ppt-maker/core build`（dist 不入库）。
  本仓库**没有 lint 脚本**，风格检查是 `pnpm format:check`。

## 已知仍待定的（留给子任务 brainstorm，不是遗漏）

- RK2 生成图的跨页风格一致性方案 → 子任务③
- 内容规格的具体形状（定稿即冻结为跨里程碑契约）→ 子任务③
- 批量源图确认界面的交互形态 → 子任务④

## 一条可选的独立清理

`"stages/review/text-blocks.json"` 这个字面量在 CLI 里有 11 处各写一份（10 个文件）。
这正是缺陷「按裸 role / 各写各的路径」能存在的土壤。集中到单一来源是一次机械清理，
本轮刻意没混进缺陷修复。要做的话单独开一条，不要顺手夹带。
