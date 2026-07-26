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
- **必须带过去的部分**：视觉走查（C9–C11 画布标注、D1–D3 合成预览、R2.2 滑块对比）与端到端门停顿走查（E1）需要含图片的完整工作区。**今晚把 `~/test/ppttest-2026-07-25` 整个目录拷到另一台机器**，或在那台机器上重新 `deck init` + 跑 pipeline（有 API 调用成本）。

详见 `research/README.md` 的「快照能做什么、不能做什么」。

### Trellis 状态

任务当前为 `planning`。明天开工顺序：

```bash
python3 ./.trellis/scripts/task.py current      # 确认指向 07-26-review-flow-simplification
python3 ./.trellis/scripts/task.py start        # 状态转 in_progress，之后才能改代码
```

开工前重读 `prd.md` 的决策表（D1–D8）与本文件的「复核门与既有约束的关系」。

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

- [ ] A1 `packages/core/src/text-blocks.ts` 新增 `LAYOUT_TEXT_MUST_BE_MASKED` 校验规则（`layout_text && !includeInMask` → error）
- [ ] A2 `REVIEW_VALIDATION_RULES_VERSION` 升为 `review-validation-v2`
- [ ] A3 `buildFreshBlock` 的 `includeInMask` 改为 `classification === "layout_text"`
- [ ] A4 新增 `compareBlockSources(block): BlockSourceTexts`（去空白后逐字比较 `offline_ocr` 与 `ai_text_assist` 来源文本）
- [ ] A5 从 `apps/cli/src/pptx/synthesize.ts` 把 `resolveFontSizePt` / `toAlign` / `toValign` / `toBold` / `fontSizePtFromPx` 提到 core 并从 core 重新导出；`synthesize.ts` 改为 import（**不改变任何计算逻辑**）
- [ ] A6 测试：`LAYOUT_TEXT_MUST_BE_MASKED` 命中与不命中各一例（命中样本取 `research/data-snapshot/page-02` 的 `block-045`）；`buildFreshBlock` 三种分类的 `includeInMask` 默认值；`compareBlockSources` 覆盖一致 / 分歧 / 缺一个来源三种情形（分歧样本取 `page-02` 的 `block-009`：`象衽鲍洁高雅、连锦不绝，` → `象征洁净高雅、连绵不绝，`）
- [ ] A7 测试：A5 迁移后 `resolveFontSizePt` 对 `fontSizePx` 非空与为空（按行数估算）两条路径结果与迁移前一致

**验证**：`pnpm typecheck && pnpm test`。预期既有测试中依赖 `includeInMask: false` 默认值的用例需同步更新——更新时确认是断言过时而非行为回退。

**回滚点**：A 阶段单独 commit。

## 阶段 B — CLI 门与验收（R1、design §3）

- [ ] B1 `run-from.ts` 在 `mask` 分支前插入 human-edit 门判定（`stoppedAt: "review"`、`gate: "human-edit"`、消息含待复核块数）
- [ ] B2 `run-from.ts` 拆分 `accept-clean || accept-pptx` 分支：`accept-clean` 直接跳过不返回门；`accept-pptx` 保留 `manual` 门
- [ ] B3 `pptx/run.ts` 的 `assertAcceptedCleanPlate` 改为断言「`clean` 阶段 completed 且产物哈希匹配、非 stale」，移除「人工已接受」前置；人工已接受的断言移入 B4
- [ ] B4 新增 `apps/cli/src/slide/accept-final.ts`：顺序调 `runAcceptClean` + `runAcceptPptx`，note 统一前缀「经最终产物确认统一验收：」，失败不回滚（重试幂等）
- [ ] B5 CLI 注册 `slide accept-final <workspace>`；`accept-clean` / `accept-pptx` 子命令保留
- [ ] B6 `mask/run.ts:155` 与 `pptx/run.ts:103` 的复核门禁保留为兜底，不改动
- [ ] B7 测试：新页 `runSlideRunFrom("ocr")` 在存在未复核 layout_text 时返回 `gate: "human-edit"` 且 `stoppedAt: "review"`
- [ ] B8 测试：全部复核后继续 run 直通至停在 `accept-pptx`，`accept-clean` 未产生停顿
- [ ] B9 测试：`runAcceptFinal` 写入两条验收记录，结构与单步 `runAcceptClean` / `runAcceptPptx` 一致；重复调用幂等
- [ ] B10 测试：既有已完成页（两个 accept 均 completed）走新逻辑不产生任何停顿

**验证**：`pnpm test` + 用备份工作区跑一次 `slide run --from ocr --confirm-api --confirm-upload`，确认停在 human-edit 门（page-02 应先因 A1 校验在 `validation-failed` 停下，这是 R4.3 的预期行为）。

**风险点**：B3 是本任务对既有质量约束改动最大的一处。改动后必须确认 `deck export --strict` 仍要求 `accept-pptx` completed，语义未被削弱。

**回滚点**：B 阶段单独 commit。

## 阶段 C — 文本复核界面（R3、design §4.1–4.2）

- [ ] C1 新增 `lib/review-partition.ts`：`partitionOf(block)` 三分区派生（object_symbol 与 uncertain → 分类待确认；layout_text 按 `compareBlockSources().agrees` 二分）。测试断言用 `research/data-snapshot` 的实测值：page-01 = 25 / 16 / 19，page-02 = 45 / 18 / 32
- [ ] C2 新增 `lib/text-diff.ts`：字符级 LCS diff，输出分段（相同 / 仅在 OCR / 仅在 assist）
- [ ] C3 新增 `components/review/BlockListPanel.tsx`：三分区、计数徽标、已一致区默认折叠 + 「全部通过」
- [ ] C4 新增 `components/review/TextDiffRow.tsx`：上行 OCR 原文（muted，diff 段高亮）、下行可编辑 textarea；超长文本回退整行并排
- [ ] C5 新增 `components/review/ClassificationRow.tsx`：文本 + 「改为版式文字」单击动作
- [ ] C6 新增 `components/review/ReviewShortcutBar.tsx`：快捷键常驻可见
- [ ] C7 `slide-store`：`updateBlock` 补写 `updatedAt` 并向 `sources` 追加 `manual` 条目；`markAllReviewed` 明确**不**写这两项
- [ ] C8 新增 `components/review/DeleteBlockButton`（或并入项卡）：删除块走既有 `save-review`
- [ ] C9 `ReviewCanvas` 改造：移除块内文本叠加与 `TextEditor` 引用；三态标注（当前项 / 同分区 / 其他分区淡化）；分类不再用边框色编码
- [ ] C10 `useCanvasTransform` 新增 `centerOn(bbox)`；当前项变化时自动居中
- [ ] C11 块整体拖动保留；删除 `TextBlockHandle.tsx` 与 8 手柄逻辑
- [ ] C12 键盘流：Tab/↓ 下一项、Shift+Tab/↑ 上一项、聚焦项 textarea 直接可打字、Enter 标记已复核并前进、⌥1/⌥2 切分类、⌘S 保存
- [ ] C13 `layout_text && !includeInMask` 的项显示「会重影」警告 + 一键修正（R3.10）
- [ ] C14 删除 `ConfidenceQueue.tsx`、`PropertyPanel.tsx`、`SourceList.tsx`、`TextEditor.tsx` 及其引用
- [ ] C15 `SlidePage` 改为 `ReviewPage`，侧边栏三标签结构移除

**验证**：`pnpm typecheck && pnpm build`；用备份工作区实际走一遍 page-02（95 块）复核，确认全键盘可完成、分区计数与 PRD F-9 的数字吻合（分类待确认 18、文字待确认 45、已一致 32）。

**回滚点**：C 阶段单独 commit。

## 阶段 D — 最终确认页（R2、design §4.3、§5）

- [ ] D1 新增 `components/final/CompositePreview.tsx`：clean plate 背景 + 绝对定位文本层，字号按 `resolveFontSizePt` × 显示缩放换算，`white-space: pre-wrap` 保留 `lines` 换行
- [ ] D2 新增 `components/final/CheckSummary.tsx`：pptx 六项 passed/failed + clean 四组裸指标并标注「当前无判定阈值」
- [ ] D3 新增 `pages/FinalConfirmPage.tsx`：预览 / 滑块对比切换、差异明示提示、三个动作（完成 / 重做底板 / 回到文本复核）
- [ ] D4 main 新增 `slide:accept-final` IPC；新增 `slide:open-pptx`（`shell.openPath`）
- [ ] D5 `deck-runner.ts`：`page-done` 的 gate 增加 `human-edit`；ActivityLog 文案更新
- [ ] D6 `lib/accept-gate.ts` 简化为只推导「待最终确认」单一闸门
- [ ] D7 `stores/todo-queue.ts` 分组改为：需文本复核 / 需修数据错误 / 待最终确认 / 失败；删除「待验收 clean」
- [ ] D8 删除 `components/slide/AcceptFlow.tsx`
- [ ] D9 「重做底板」/「回到文本复核」沿用「先 invalidate 再启动」纪律（避免 `SlidePage.tsx:245` 注释记录的空转）

**验证**：备份工作区跑到最终确认，肉眼对比合成预览与 PowerPoint for Mac 中打开的实际 PPTX；确认「完成」后 manifest 两条验收记录齐备且 `deck status` 可读；确认「重做底板」真的重跑而非空转。

**回滚点**：D 阶段单独 commit。

## 阶段 E — 全链路走查与收尾

- [ ] E1 全新 deck（重新 `deck init`）跑完整链路：批量处理 → 停 human-edit → 复核 → 继续 → 停最终确认 → 完成 → report 补跑 → 导出
- [ ] E2 验证既有已完成工作区打开无异常、无需迁移
- [ ] E3 `pnpm format:check && pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] E4 逐条核对 PRD 验收标准四层
- [ ] E5 更新 `ROADMAP.md` 的 M4 状态与技术结论；记录 D1/D8 对既有约束的解除
- [ ] E6 按 Phase 3 更新 spec（阶段门语义变更、双源比对判据、合成预览与 PPTX 的公式同源约定）

## 风险文件与注意事项

| 文件 | 风险 |
|---|---|
| `apps/cli/src/pptx/run.ts` | B3 放宽 `assertAcceptedCleanPlate` 前置条件，是本任务对质量约束改动最大处；必须确认 `--strict` 导出语义未被削弱 |
| `packages/core/src/text-blocks.ts` | A1/A3 会使既有工作区校验失败并触发 mask 及下游失效，属预期但需在走查中确认表现为「停在复核门 + 可一键修正」而非「阶段执行失败」 |
| `apps/cli/src/pptx/synthesize.ts` | A5 是纯搬迁，任何计算逻辑变动都会让 PPTX 输出漂移；必须有迁移前后一致性测试 |
| `apps/desktop/src/renderer/pages/SlidePage.tsx` | C15 大规模重写；`rerunFrom` 的「先失效再启动」纪律与 `pageBusy → reloadImages` 的产物刷新时序必须保留 |
| `apps/desktop/src/renderer/stores/todo-queue.ts` | D7 分组变更影响控制台「点一次到达」的验收项 |

## 复核门与既有约束的关系（实现时勿动摇）

- 人工门不可自动跳过——D1 是把**五个门收敛为两个**，不是取消人工确认。
- `mask/run.ts` 与 `pptx/run.ts` 的复核门禁保留为兜底，直接调单阶段命令时仍必须拦截。
- UI 不得绕过复核、版本与恢复契约；所有数据写入仍走既有业务函数。
