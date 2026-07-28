# 复核链路简化与文本复核体验重构 — 执行计划

> 分五阶段推进：core → cli → 复核界面 → 最终确认页 → 收尾。每阶段独立可验证，后端两阶段先落地并补测试，再动 UI。

## 开工前置（换机器时必读）

### 环境

| 项 | 要求 | 缺失后果 |
|---|---|---|
| macOS | 必需 | Apple Vision OCR 与 PowerPoint 验收都依赖 |
| Node | ≥ 24（`package.json` engines） | 装不上依赖 |
| pnpm | 10.x（`packageManager: pnpm@10.32.0`） | lockfile 不兼容 |
| Xcode 命令行工具 | `xcrun swiftc` 可用 | `pnpm build` 的 `build:vision` 失败 |
| 微软雅黑字体 | 已安装 | `doctor` 不通过，PPTX 导出被阻止 |
| PowerPoint for Mac | 已安装 | 阶段 D 的最终把关与 R2 验收无法做 |
| `OPENAI_API_KEY` | 已配置 | `assist-review` 与 clean plate 生成不可用（阶段 E1 需要） |

首次准备：

```bash
pnpm install
pnpm build          # 含 build:vision，需要 xcrun
pnpm test           # 基线，应全绿（改动前 36 个测试文件）
node apps/cli/dist/index.js doctor
```

### 真实数据（关键）

`prd.md` 与 `design.md` 的全部证据来自真实工作区 `~/test/ppttest-2026-07-25`（29 MB，含源图与 clean plate），**该工作区不在仓库内**。

- **仓库内已有的部分**：`research/data-snapshot/`（216 KB，两页 `text-blocks.json` + clean 检查指标）与 `research/measure.py`。阶段 A、B 的全部测试和阶段 C 的分区计数验证只需要这些，跑 `python3 .trellis/tasks/07-26-review-flow-simplification/research/measure.py` 即可复现 PRD 的每个数字。
- **必须带过去的部分**：视觉走查（C9–C11 画布标注、D1–D3 合成预览、R2.2 滑块对比）与端到端门停顿走查（E1）需要含图片的完整工作区。整目录拷过去，或在新机器上重新 `deck init` + 跑 pipeline（有 API 调用成本）。

详见 `research/README.md` 的「快照能做什么、不能做什么」。

### 换机清单（2026-07-26 晚，C 完成后切到另一台机器）

仓库外的东西一样都不会跟着 git 走，逐项确认：

| 项 | 位置 | 处理 |
|---|---|---|
| **代码提交** | 7 个提交（含阶段 A/B/C）曾长期滞留本地 | `git push origin main`，新机器 `git clone` 或 `git pull` |
| **`.env`** | 仓库根，**已 gitignore** | 手动重建：`OPENAI_API_KEY` 与 `OPENAI_BASE_URL`（用的是第三方兼容端点，两个都要），照 `.env.example` 的键名 |
| **真实工作区** | `~/test/ppttest-2026-07-25`（29 MB） | 整目录拷过去。**它已含 2026-07-26 走查的改动**：page-02 的 `block-031/039/045/079/081` 已改分类并入 mask，但受下述「遗留缺陷」影响，mask 及下游产物尚未跟着更新，manifest 仍显示全部 completed |
| **工作区备份** | `~/test/ppttest-2026-07-25.bak-baseline`（未改动的基线）与 `.bak-225336`（走查前） | 各 29 MB，按需拷；基线那份值得留 |
| **Trellis 当前任务指针** | 会话级，不随仓库走 | 新机器执行 `python3 ./.trellis/scripts/task.py start 07-26-review-flow-simplification` |
| **跨会话记忆** | `~/.claude/projects/.../memory/` | **不会跟着仓库走**。所有接续所需信息都已写进本文件，以它为准 |

新机器首次准备照上面「环境」与「首次准备」两节做一遍。本机 `doctor` 基线：5 通过 / 1 警告（Node v25.6.1 偏离 24 LTS，不阻塞）/ 0 失败；微软雅黑走的是 PowerPoint 内置 `msyh.ttc`，所以 **PowerPoint for Mac 必须装**，否则字体检查直接失败、PPTX 导出被阻止。

### Trellis 状态

任务为 `in_progress`。阶段 A（`e03af4a`）、B（`a0de457`）、C（`1cbd994`）已完成，另有三个走查修复与文档提交（`d489777`、`5d2565c`、`e3b5d22`）。**下一步从阶段 D1 起**。

```bash
python3 ./.trellis/scripts/task.py start 07-26-review-flow-simplification
python3 ./.trellis/scripts/task.py current      # 确认指向本任务
```

开工前重读 `prd.md` 的决策表（D1–D8）、本文件的「A/B 阶段已完成」「C 阶段已完成」两节与「复核门与既有约束的关系」。阶段 D 会用到阶段 A 提到 core 的公式（`packages/core/src/pptx-text-style.ts` 的 `resolveFontSizePt` / `toAlign` / `toValign` / `toBold`），与 `synthesize.ts` 同源，**勿重写**。

## 验证命令

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

数据快照复现（不需要真实工作区）：

```bash
python3 .trellis/tasks/07-26-review-flow-simplification/research/measure.py
```

真实数据回归工作区：`~/test/ppttest-2026-07-25`（2 页，155 块）。**每次回归前先备份**：

```bash
cp -R ~/test/ppttest-2026-07-25 ~/test/ppttest-2026-07-25.bak-$(date +%H%M%S)
```

## 阶段 A — core 契约与校验（R4、design §2）

- [x] A1 `packages/core/src/text-blocks.ts` 新增 `LAYOUT_TEXT_MUST_BE_MASKED` 校验规则（`layout_text && !includeInMask` → error）
- [x] A2 `REVIEW_VALIDATION_RULES_VERSION` 升为 `review-validation-v2`
- [x] A3 `buildFreshBlock` 的 `includeInMask` 改为 `classification === "layout_text"`
- [x] A4 新增 `compareBlockSources(block): BlockSourceTexts`（去空白后逐字比较 `offline_ocr` 与 `ai_text_assist` 来源文本）
- [x] A5 从 `apps/cli/src/pptx/synthesize.ts` 把 `resolveFontSizePt` / `toAlign` / `toValign` / `toBold` / `fontSizePtFromPx` 提到 core 并从 core 重新导出；`synthesize.ts` 改为 import（**不改变任何计算逻辑**）
- [x] A6 测试：`LAYOUT_TEXT_MUST_BE_MASKED` 命中与不命中各一例（命中样本取 `research/data-snapshot/page-02` 的 `block-045`）；`buildFreshBlock` 三种分类的 `includeInMask` 默认值；`compareBlockSources` 覆盖一致 / 分歧 / 缺一个来源三种情形（分歧样本取 `page-02` 的 `block-009`：`象衽鲍洁高雅、连锦不绝，` → `象征洁净高雅、连绵不绝，`）
- [x] A7 测试：A5 迁移后 `resolveFontSizePt` 对 `fontSizePx` 非空与为空（按行数估算）两条路径结果与迁移前一致

**验证**：`pnpm typecheck && pnpm test`。预期既有测试中依赖 `includeInMask: false` 默认值的用例需同步更新——更新时确认是断言过时而非行为回退。

**回滚点**：A 阶段单独 commit。

## 阶段 B — CLI 门与验收（R1、design §3）

- [x] B1 `run-from.ts` 在 `mask` 分支前插入 human-edit 门判定（`stoppedAt: "review"`、`gate: "human-edit"`、消息含待复核块数）
- [x] B2 `run-from.ts` 拆分 `accept-clean || accept-pptx` 分支：`accept-clean` 直接跳过不返回门；`accept-pptx` 保留 `manual` 门
- [x] B3 `pptx/run.ts` 的 `assertAcceptedCleanPlate` 改为断言「`clean` 阶段 completed 且产物哈希匹配、非 stale」，移除「人工已接受」前置；人工已接受的断言移入 B4。**用户已于 2026-07-26 确认此改动可执行（PRD R1.4），按计划推进，不必再次征询**
- [x] B4 新增 `apps/cli/src/slide/accept-final.ts`：顺序调 `runAcceptClean` + `runAcceptPptx`，note 统一前缀「经最终产物确认统一验收：」，失败不回滚（重试幂等）
- [x] B5 CLI 注册 `slide accept-final <workspace>`；`accept-clean` / `accept-pptx` 子命令保留
- [x] B6 `mask/run.ts:155` 与 `pptx/run.ts:103` 的复核门禁保留为兜底，不改动
- [x] B7 测试：新页 `runSlideRunFrom("ocr")` 在存在未复核 layout_text 时返回 `gate: "human-edit"` 且 `stoppedAt: "review"`
- [x] B8 测试：全部复核后继续 run 直通至停在 `accept-pptx`，`accept-clean` 未产生停顿
- [x] B9 测试：`runAcceptFinal` 写入两条验收记录，结构与单步 `runAcceptClean` / `runAcceptPptx` 一致；重复调用幂等
- [x] B10 测试：既有已完成页（两个 accept 均 completed）走新逻辑不产生任何停顿
- [x] B11 测试（B3 批准的前提条件）：`accept-pptx` 未 completed 的页在 `deck export --strict` 下仍被拒绝；`pptx` 阶段在 `clean` 为 stale 时仍拒绝生成

**验证**：`pnpm test` + 用备份工作区跑一次 `slide run --from ocr --confirm-api --confirm-upload`，确认停在 human-edit 门（page-02 应先因 A1 校验在 `validation-failed` 停下，这是 R4.3 的预期行为）。

**风险点**：B3 是本任务对既有质量约束改动最大的一处，**已获用户明确批准（2026-07-26）**。改动后必须确认 `deck export --strict` 仍要求 `accept-pptx` completed，语义未被削弱——这是批准的前提条件，必须实测验证而非假定。

**回滚点**：B 阶段单独 commit。

### A/B 阶段已完成（commit e03af4a、a0de457）

**实施中发现的计划缺口与用户决策（2026-07-26）**：`design.md §3.2` 只写了改 `assertAcceptedCleanPlate`，但那不是唯一拦截点——`packages/core/src/stage-graph.ts` 声明 `pptx: ["accept-clean"]`，而 `runSlidePptx` 在调 `assertAcceptedCleanPlate` **之前**先跑 `assertStageDependenciesCompleted(stages, "pptx")`（`apps/cli/src/pptx/run.ts`）。只改断言会让 accept-clean 直通后 pptx 在依赖图层被拒。

**用户已确认采用方案**：把 `STAGE_DEPENDENCIES.pptx` 改为 `["clean"]`。

- 这使 `check.jsonl` 里「检查 STAGE_DEPENDENCIES 未被改动」一条**作废**，改为核对下面的安全属性。
- 安全属性核对（已由测试与真实工作区实测覆盖）：`clean` 失效仍直接连带 pptx 及下游失效；`deck export --strict` 仍要求每页 `accept-pptx` completed；mask/pptx 的复核兜底门禁原样保留。
- 已知语义收窄：`getDownstreamStages("accept-clean")` 变空，即单独失效 accept-clean 不再连带失效 pptx。新流程下 accept-clean 只在最终确认时写入，此行为可接受。
- 不需要 manifest 迁移：阶段枚举与状态结构均未变。

其余落地差异：`assertAcceptedCleanPlate` 改名为 `assertUsableCleanPlate`（`apps/cli/src/deck/export.ts` 的调用点同步更新）；A5 的公式落在新建的 `packages/core/src/pptx-text-style.ts`，`synthesize.ts` 改为 import 并重新导出。

## 阶段 C — 文本复核界面（R3、design §4.1–4.2）

> **阶段 A 已提供、C 直接从 `@ppt-maker/core` import，勿重写**：
> `compareBlockSources(block): BlockSourceTexts`（C1 分区判据的唯一来源）、
> `resolveFontSizePt` / `fontSizePtFromPx` / `toAlign` / `toValign` / `toBold`（D1 合成预览用）。
> 阶段 B 已提供：`gate: "human-edit"` + `stoppedAt: "review"`（C15 与 D7 按此定位界面）、
> `slide accept-final`（D4 的 IPC 直接调 `runAcceptFinal`）。

- [x] C1 新增 `lib/review-partition.ts`：`partitionOf(block)` 三分区派生（object_symbol 与 uncertain → 分类待确认；layout_text 按 `compareBlockSources().agrees` 二分）。测试断言用 `research/data-snapshot` 的实测值：page-01 = 25 / 16 / 19，page-02 = 45 / 18 / 32
- [x] C2 新增 `lib/text-diff.ts`：字符级 LCS diff，输出分段（相同 / 仅在 OCR / 仅在 assist）
- [x] C3 新增 `components/review/BlockListPanel.tsx`：三分区、计数徽标、已一致区默认折叠 + 「全部通过」
- [x] C4 新增 `components/review/TextDiffRow.tsx`：上行 OCR 原文（muted，diff 段高亮）、下行可编辑 textarea；超长文本回退整行并排
- [x] C5 新增 `components/review/ClassificationRow.tsx`：文本 + 「改为版式文字」单击动作
- [x] C6 新增 `components/review/ReviewShortcutBar.tsx`：快捷键常驻可见
- [x] C7 `slide-store`：`updateBlock` 补写 `updatedAt` 并向 `sources` 追加 `manual` 条目；`markAllReviewed` 明确**不**写这两项
- [x] C8 新增 `components/review/DeleteBlockButton`（或并入项卡）：删除块走既有 `save-review`
- [x] C9 `ReviewCanvas` 改造：移除块内文本叠加与 `TextEditor` 引用；三态标注（当前项 / 同分区 / 其他分区淡化）；分类不再用边框色编码
- [x] C10 `useCanvasTransform` 新增 `centerOn(bbox)`；当前项变化时自动居中
- [x] C11 块整体拖动保留；删除 `TextBlockHandle.tsx` 与 8 手柄逻辑
- [x] C12 键盘流：Tab/↓ 下一项、Shift+Tab/↑ 上一项、聚焦项 textarea 直接可打字、Enter 标记已复核并前进、⌥1/⌥2 切分类、⌘S 保存
- [x] C13 `layout_text && !includeInMask` 的项显示「会重影」警告 + 一键修正（R3.10）
- [x] C14 删除 `ConfidenceQueue.tsx`、`PropertyPanel.tsx`、`SourceList.tsx`、`TextEditor.tsx` 及其引用
- [x] C15 `SlidePage` 改为 `ReviewPage`，侧边栏三标签结构移除

**验证**：`pnpm typecheck && pnpm build`；用备份工作区实际走一遍 page-02（95 块）复核，确认全键盘可完成、分区计数与 PRD F-9 的数字吻合（分类待确认 18、文字待确认 45、已一致 32）。

**回滚点**：C 阶段单独 commit。

### C 阶段已完成（2026-07-26）

工程验证四项全绿：`pnpm format:check`、`pnpm typecheck`、`pnpm test`（core 76 + desktop 195 + cli 91）、`pnpm build`。分区计数由 `test/review-partition.test.ts` 用真实快照断言，与 PRD F-9 完全吻合（page-01 = 25/16/19，page-02 = 45/18/32）。

**真实工作区走查（2026-07-26，`~/test/ppttest-2026-07-25` page-02）**：

已确认：

- 画布当前项高亮在彩色底图上清晰可辨、跟随生效（修完下述两个缺陷后用户确认）。
- C13 重影警告与一键修正可用：`block-045`（`色彩含义`）已修正为参与去字。
- C5 分类切换可用：`block-031 口沿`、`block-039 ◎ 颈部`、`block-079 历史脉络`、`block-081 鉴赏与收藏` 由 object_symbol 改回 layout_text —— 正是 F-7 里会静默漏字的那批。
- C7 溯源如实：上述 5 个块的 `updatedAt` 与 `manual` 来源均正确写入（manual 条目为原地更新的单条，`offline_ocr` / `ai_text_assist` 未被破坏），page-01 未被误写。改动后两条 mask 校验约束都干净，分区变为 45 / 14 / 36。

走查中修掉的两个缺陷（commit 5d2565c）：

- **跟随是空操作**。`centerOn` 的按轴边界夹取在 fit-to-view 下必然零位移（fit 的定义就是两轴都装得下），而去掉夹取又会让靠边的块把整图推出视口露白底——只居中不缩放这条路本身不成立。改为 `focusOn`：放大到当前项约 44px 屏幕高（正文行原图仅 13–19px，fit 后不足 8px，那尺寸下没法拿原图核对双源分歧），比例夹在 `[整页fit, 3×]`。
- **高亮被缩放吃掉**。标注 div 在缩放容器内，`border-2` 实际渲染宽度是 `2px × scale`；2048 宽的图 fit 进 ~780px 画布时 scale≈0.38，边框只剩 0.76px。所有描边与光晕改为按 `scale` 反算。

**仍未验证**：R3.5 的「全程仅用键盘完成一页复核」——走查中的改动经由鼠标完成，键盘流（Tab/↑↓ 推进、直接打字、Enter 确认前进、⌥1/⌥2 切分类）未逐项实测。留给 E1 一并做。

**落地差异与实现决策**：

- **阶段 D 的边界按最小改动划**：`compare` / `accept` 两个视图态与 `AcceptFlow` 在 C 阶段原样保留——`FinalConfirmPage` 属阶段 D，提前拆掉会出现「没有任何验收路径」的空窗。工具栏「全部标为已复核」同样保留：移除它不在 C 的条目里，但它正是 F-6 的逃生口，随 D7 收敛待办分组时一并处理更合适。
- **分区内保持存储顺序**：`design.md` §4.1 写的是「按 `zIndex` 后 `readingOrder` 排列」，但契约里并不存在 `readingOrder` 字段，`text-blocks.json` 的存储顺序即阅读顺序，故不做任何重排。
- **C7 抽出 `lib/block-edit.ts`**：`applyManualEdit` / `markBlocksReviewedById` / `deleteBlockById` 三个纯函数从 store 里分出来，测试不必造 zustand 环境。踩到的契约坑：`TextBlockSourceSchema.text` 是 `z.string().min(1)` 而 `TextReviewBlock.text` 允许空串，编辑成空串时必须移除 manual 条目，否则保存被 zod 拒绝。
- **C10 `centerOn` 增加按轴边界夹取**：无条件居中会在 fit-to-view 尺度下把靠边的块拉到正中、露出大片空白底。现在该轴上内容比视口窄时保持居中，否则夹在「内容边缘不越过视口边缘」的范围内。
- **C12 键盘流落在 `BlockListPanel` 内**，页面壳只保留 ⌘S 的 window 监听。两个判断：⌥1/⌥2 用 `event.code` 而非 `event.key`（macOS 上 ⌥1 的 `key` 是 `¡`）；焦点在项内按钮上时 Enter 放行冒泡，否则 keydown 的 `preventDefault` 会把按钮的 click 一起吃掉。推进到折叠的「已一致」分区时**自动展开**而非跳过——跳过会让折叠区里的块永远无法用键盘到达，与「全程仅用键盘完成一页复核」冲突。
- **切分类必须同改 `includeInMask`**：阶段 A 的 `LAYOUT_TEXT_MUST_BE_MASKED` 把「layout_text 却不参与 mask」判为 error，只改分类会一改就触发校验失败。`ClassificationRow` 同时提供反向动作（改回对象符号 + `includeInMask=false`）。
- **测试夹具进仓**：`test/fixtures/review-partition/page-0{1,2}.json` 是 `research/data-snapshot` 的逐字副本——任务归档后 `.trellis/tasks/` 路径会失效，测试不能依赖它。相应地 `biome.json` 增加 `files.includes` 排除 `**/test/fixtures`，夹具必须与快照逐字一致，不能被格式化。
- **「全部通过」只出现在「已一致」分区**：另两个分区给批量入口等于把 F-6 的「一键全标已复核」搬回来。

## 阶段 D — 最终确认页（R2、design §4.3、§5）

- [x] D1 新增 `components/final/CompositePreview.tsx`：clean plate 背景 + 绝对定位文本层，字号按 `resolveFontSizePt` × 显示缩放换算，`white-space: pre-wrap` 保留 `lines` 换行
- [x] D2 新增 `components/final/CheckSummary.tsx`：pptx 六项 passed/failed + clean 四组裸指标并标注「当前无判定阈值」
- [x] D3 新增 `pages/FinalConfirmPage.tsx`：预览 / 滑块对比切换、差异明示提示、三个动作（完成 / 重做底板 / 回到文本复核）
- [x] D4 main 新增 `slide:accept-final` IPC；新增 `slide:open-pptx`（`shell.openPath`）
- [x] D5 `deck-runner.ts`：`page-done` 的 gate 增加 `human-edit`；ActivityLog 文案更新
- [x] D6 `lib/accept-gate.ts` 简化为只推导「待最终确认」单一闸门
- [x] D7 `stores/todo-queue.ts` 分组改为：需文本复核 / 需修数据错误 / 待最终确认 / 失败；删除「待验收 clean」
- [x] D8 删除 `components/slide/AcceptFlow.tsx`
- [x] D9 「重做底板」/「回到文本复核」沿用「先 invalidate 再启动」纪律（避免 `SlidePage.tsx:245` 注释记录的空转）

**验证**：备份工作区跑到最终确认，肉眼对比合成预览与 PowerPoint for Mac 中打开的实际 PPTX；确认「完成」后 manifest 两条验收记录齐备且 `deck status` 可读；确认「重做底板」真的重跑而非空转。

**回滚点**：D 阶段单独 commit。

### D 阶段已完成（2026-07-27，工程验证部分）

实施方式：四路并行（main/IPC、展示组件、闸门与队列、确认页），跨轨契约先写进 `channels.ts` 再分发，集成（ReviewPage 接线、SlideToolbar、删除件）由主会话收口。**真实工作区走查尚未做，留在 E1**。

**计划外但必须的新增**：

- **`slide:load-final-checks` IPC**。design §4.3 要求最终确认页展示 pptx 六项与 clean 指标，但 renderer 侧根本没有读取产物记录的通道——既有 IPC 只有 review 文档、图片、失效与验收。新增只读 handler：pptx 取 `stages/pptx/check.json`，clean 取当前 attempt 的 `record.json.checks`，缺失一律 null 而非抛错。
- **`SlideDetail.pendingTextReview`**。design §3.4 的「需文本复核」耐久判据是「存在 `layout_text && unreviewed` 块」，而 `SlideDetail` 只由 manifest 聚合而来，没有块级信息。改为 main 侧读 `text-blocks.json` 数出该值随详情下发；读不到为 0。
- **`shared/gates.ts`**。闸门中文文案此前散在 main 的活动日志与 renderer 的即时记录两处，`human-edit` 与 `manual` 语义变更后两侧必须逐字一致（否则同一条事件刷新前后两种说法），抽为单点。

**落地差异与实现决策**：

- **「回到文本复核」失效 `mask` 而非 design §4.3 写的 `review`**。要的效果是「让复核改动传到下游」；失效 `review` 会让续跑从 review 起重做，白白再打一次 assist-review 的付费调用，并让刚编辑过的文档重走一遍候选合并。`mask` 是 review 之后第一个持久阶段，失效它即连带 clean/pptx/accept-* 全部失效，复核文档本身不动。该动作**不自动重跑**（用户此刻尚未改任何字），改完保存再点「运行此页」；「重做底板」则维持「先 invalidate 再启动」的即时重跑。
- **工具栏「全部标为已复核」连同 `markAllBlocksReviewed` 一并删除**。C 阶段暂留它作为 F-6 的逃生口，D7 收敛后没有保留理由：整页一键标记正是 155 块全 `reviewed` 却无一条 `updatedAt` 的成因。工具栏改为只读展示待复核数——数量仍是「这页还欠多少人工确认」的唯一提示。批量确认只剩「已一致」分区的「全部通过」（`markBlocksReviewedById`，作用域限定双源逐字一致的块）。
- **`SlideViewMode` 收敛为 `review` / `final`**：`compare` 档降级为最终确认页内部的一档视图，`accept` 档由 `final` 取代，恰好对应链路仅剩的两个人工停点。
- **`GROUP_ORDER` 把 `failed` 排在最前**，与 design §3.4 表格的列举顺序不同：延续既有约定（最紧急的先处理），不构成语义冲突。
- **合成预览容器固定 16:9 并让底板拉伸填满**：PPTX 把 clean plate 满铺到 13.333×7.5 英寸版面（`synthesize.ts` 的 `addImage`），而真实底板是 1672×940（PRD F-4 记录的 gpt-image-2 尺寸偏差），不强制 16:9 的话块的百分比定位会与 PPT 版面对不上。

## 阶段 E — 全链路走查与收尾

- [ ] E1 全新 deck（重新 `deck init`）跑完整链路：批量处理 → 停 human-edit → 复核 → 继续 → 停最终确认 → 完成 → report 补跑 → 导出
- [ ] E2 验证既有已完成工作区打开无异常、无需迁移
- [ ] E3 `pnpm format:check && pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] E4 逐条核对 PRD 验收标准四层
- [ ] E5 更新 `ROADMAP.md` 的 M4 状态与技术结论；记录 D1/D8 对既有约束的解除
- [ ] E6 按 Phase 3 更新 spec（阶段门语义变更、双源比对判据、合成预览与 PPTX 的公式同源约定）

## 遗留缺陷：保存复核不失效下游，改动传不到产物（待另立任务）

**2026-07-26 真实工作区走查中发现，属既有缺陷、非本任务引入；用户已确认记录后再做。**

**现象**：在一个全部阶段已 completed 的页上改复核内容并保存，界面仍显示「完成」，但 mask/clean/pptx 产物不会更新——去字底板里那几块字没被抹掉，PPTX 却已给它们生成文本框。产物与复核数据静默分歧，与 F-8 同类。

**复现**：`~/test/ppttest-2026-07-25` page-02（10 个阶段全 completed），把 `block-031/039/079/081` 由 object_symbol 改为 layout_text（连带 `includeInMask=true`）、修正 `block-045` 的重影，⌘S 保存。text-blocks.json 正确写入，manifest 各阶段状态一字未变。

**链路**：

1. `apps/desktop/src/main/ipc/slide.ts:70` 的 `slide:save-review` 只写文件 + 做内存校验，不调用任何失效逻辑；
2. `computeResumeStage`（`apps/desktop/src/main/slide-detail.ts`）全部 completed 时返回 null；
3. `apps/desktop/src/main/runner/deck-runner.ts:93` 对显式点名的单页把起点兜底成 `report`，于是 mask 及以后一步都不执行。

`mask/run.ts:376` 本身有正确的指纹判断（输入变了就重做并连带失效下游），问题是它根本没被调用到。

**建议修法**：`slide:save-review` 写盘前读取旧文档，用 core 的 `maskInvalidationProjection`（`packages/core/src/text-blocks.ts:426`）比对：投影变了失效 `mask`，只有文本/样式变了失效 `pptx`，都没变则不失效。正好复用既有的变更粒度矩阵（见 `apps/cli/test` 的「变更粒度失效矩阵」用例），不会让「只改了个错字」也去烧一次 gpt-image-2。

**注意**：不要图省事一律失效 `mask`——`invalidate.ts` 的语义是「强制重做而不是幂等跳过」，那会让每次保存都触发一次 clean 的付费调用。

**临时绕行**：工具栏「从阶段重跑 → 文字校验」，走 validate-review → mask → clean → pptx。

## 风险文件与注意事项

| 文件 | 风险 |
|---|---|
| `apps/cli/src/pptx/run.ts` | B3 放宽 `assertAcceptedCleanPlate` 前置条件，是本任务对质量约束改动最大处（已获批准，2026-07-26）；必须**实测**确认 `--strict` 导出语义未被削弱，这是批准的前提条件 |
| `packages/core/src/text-blocks.ts` | A1/A3 会使既有工作区校验失败并触发 mask 及下游失效，属预期但需在走查中确认表现为「停在复核门 + 可一键修正」而非「阶段执行失败」 |
| `apps/cli/src/pptx/synthesize.ts` | A5 是纯搬迁，任何计算逻辑变动都会让 PPTX 输出漂移；必须有迁移前后一致性测试 |
| `apps/desktop/src/renderer/pages/SlidePage.tsx` | C15 大规模重写；`rerunFrom` 的「先失效再启动」纪律与 `pageBusy → reloadImages` 的产物刷新时序必须保留 |
| `apps/desktop/src/renderer/stores/todo-queue.ts` | D7 分组变更影响控制台「点一次到达」的验收项 |

## 复核门与既有约束的关系（实现时勿动摇）

- 人工门不可自动跳过——D1 是把**五个门收敛为两个**，不是取消人工确认。
- `mask/run.ts` 与 `pptx/run.ts` 的复核门禁保留为兜底，直接调单阶段命令时仍必须拦截。
- UI 不得绕过复核、版本与恢复契约；所有数据写入仍走既有业务函数。
