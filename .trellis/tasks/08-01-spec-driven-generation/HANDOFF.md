# 会话交接：子任务③ 规划完成，待实现

写于 2026-08-01 规划会话结束时。工作区干净，规划产物已提交到 `main`，**未 push**。

## 立刻做这两步

Trellis 活动任务按会话 id 绑定，换会话不会自动指向：

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-01-spec-driven-generation
pnpm --filter @ppt-maker/core build     # dist 不入库，typecheck 前必须先 build
```

**不要重新规划**。`prd.md` / `design.md` / `implement.md` 三份齐备，六个决策经一问一答定稿，
`implement.jsonl` / `check.jsonl` 已按真实 spec 清单填好。直接从 `implement.md` 阶段一开始。

## 当前状态

| 项 | 状态 |
|---|---|
| 父任务 M5 | `in_progress`，阶段一完成，阶段二进行中 |
| 子任务① 页面来源契约与换源 | 已完成并归档 → `.trellis/tasks/archive/2026-08/07-31-page-source-contract/` |
| **子任务③ 图片生成（本任务）** | **规划完成，未开始实现** |
| 子任务② PDF 抽取 | 尚未创建（与③ 互不依赖，可并行） |
| 子任务④ 桌面端入口收口 | 尚未创建，依赖②③ |
| RK1 生成图直出 16:9 | **已实证通过**，回滚点解除 |
| 测试 | 576 项全绿（core 90 + desktop 359 + cli 127） |

本轮 `main` 上的两个提交：RK1 实证 + ROADMAP 三处表述修正（`7c541d7`）、本次规划产物。

## 六个决策的结论（理由见 `prd.md`〈已定决策〉表，不再复述）

- **E1** 跨页一致性只做 deck 级**风格描述段**，一致性作实证验收点 C12；不做首页参考图。
- **E2** 条目文字用**分组** `textGroups: [{label, items}]` + 独立 `visualIntent`。
- **E3** 规格增删条目**只补生成缺失页**，删页只报告不动手。
- **E4** `revisionNotes` **全部累积**进提示词 + 引导语「后出现的优先」。
- **E5** 初稿生成**模型分页 + 逐页扩写**，一次调用，无对话。
- **E6** 规格文件用 **JSON**。

## 动手前必读

1. `.trellis/spec/backend/contracts.md`〈多代资产与「当前产物」选取契约〉
2. `.trellis/spec/guides/verification-coverage-thinking-guide.md`
3. `research/rk1/CONCLUSION.md`（RK1 证据链与两条衍生约束）

前两份是子任务① 用六个缺陷换来的，**不读会原样重犯**。

## 五个必须带进实现会话的判断

**1. 生成资产的尺寸必须落盘后实测。** 网关不返回请求的尺寸（请求 2048x1152 实得 1672×941），
且高度在 940/941 间浮动过。`createSlideWorkspace` 已用 sharp 实测填充，沿用即可，
**一行尺寸都不要自己填**。现成反例：`clean/run.ts:329` 用常量硬填 `clean_plate` 尺寸，
manifest 记 2048×1152 而磁盘实为 1672×941，07-22 记为遗留缺陷至今未修。
C3 的用例必须显式断言「资产尺寸 == 磁盘 PNG 实际像素」，不接受「== 请求参数」。

**2. `content_spec` 与 `generation_prompt` 必然多代**，每次重生成各出一份。
判据用「阶段最后一次成功 attempt」类（`attemptId === initStage.lastSuccessfulAttemptId`，
现成例子 `report/run.ts` 的 `currentSuccessAsset`）。
**禁止 `assets.find(a => a.role === "content_spec")`**——文件确实存在、哈希也对，
错的是它描述的对象已经不是当前那个，`assertWorkspaceAssetIntegrity` 查不出来。

**3. 指纹口径是「`style` + 条目」的合并视图，不是仅条目。**
改 `style` 意味着所有已生成图都过时了，只算条目会漏报。落地方式是 `content_spec` 资产
存的就是这个合并视图，让「资产内容」与「指纹覆盖范围」完全一致，不会分叉。
计算用 `sha256Values` 按 schema 显式列字段（design §2.3），**不做通用 canonical JSON**——
显式列字段顺带保证「新增字段必须显式决定是否进指纹」。

**4. `slide/replace-source.ts` 是高风险文件。** ① 刚在它里面修完四个必现缺陷。
阶段四要给它加 `referencePath`，改动后必须跑该文件既有全部用例，且**不得改动**
归档 / 失效 / 闸门重判的顺序——① 的教训是「来源重判必须排在失效之后」
（`invalidateStageAndDownstream` 会把 `accept-source` 一并转 stale，顺序颠倒会被覆盖回去），
「失效起点是 `accept-source` 而非 `init`」（init 刚刚成功，标 stale 与事实相反）。

**5. 阶段四必须早于阶段五。** `deck regenerate` 依赖带 `referencePath` 的换源；
顺序颠倒会先写出一版「重生成后参考文本还是旧的」的实现，再回头改。

## 验收形状不可简化的四条

《验收覆盖思考指南》的核心是「验收止步于哪里，缺陷就藏在哪之后」：

- **C5**：跑完整链路到 `accept-pptx` → 重生成 → **继续跑 ocr/review/mask 到 pptx 成功**。
  只验到「重生成成功」等于只证明了「没有立刻炸」。
- **C9**：fixture 必须**先断言 `content_spec` 恰好 3 条**，否则用例可能什么都没覆盖。
  最危险的 fixture 是恰好只有一条的那种——裸 `find` 在它上面碰巧也对。
- **C12**：结论依赖人工判断，**只能标 `[~]` 并写明代劳处**，不能勾 `[x]`。
- **C13**：兼容性必须在真实历史 deck 上验，**不接受仅凭 fixture 推断**。

## C12 是最大回滚点

跨页风格一致性实证不达标时：**回父任务议参考图方案，不在实现里自行改**。
此时 R1–R10 其余部分均已可交付，规格只需追加可选字段，已冻结结构不必推翻——
这正是 E1 选风格段而非参考图的核心理由。

## 走查环境

- **`~/test/ppttest-2026-07-25` 是基线**：两页、十阶段全 completed、无 `source` 字段的
  M3/M4 旧格式。C13 一律从它**复制**后验，别在它本身上跑。
- **`~/test/ppttest-archive-fix` 是唯一跑完含云调用完整链路的 deck**，要复现完整链路优先用它。
- `.env` 已配 `OPENAI_API_KEY` 与 `OPENAI_BASE_URL`（第三方网关 `dtcpa.nuts2k.eu.org`）。
  RK1 走的是这个网关，**结论不适用于官方端点**。
- `pnpm typecheck` 前必须先 `pnpm --filter @ppt-maker/core build`。
  本仓库**没有 lint 脚本**，风格检查是 `pnpm format:check`（只覆盖 `src`/`test`，不含 Markdown）。
- 复现 RK1：`node .trellis/tasks/08-01-spec-driven-generation/research/rk1/probe.mjs 2048x1152`
  （一次真实计费调用；产出图不入库）。

## 留给后续、不是遗漏

- 子任务② PDF 抽取尚未创建。与③ 互不依赖，可随时并行开。
- `clean/run.ts:329` 的硬编码尺寸是 clean 路径的遗留缺陷，**刻意不夹带**进本任务
  （① 的教训：机械清理不要混进功能实现）。要做单独开一条。
- `"stages/review/text-blocks.json"` 字面量在 CLI 里 11 处各写一份（10 个文件），
  同样是独立清理，不要顺手夹带。
- 规格形状定稿后须回写父任务 `design.md` §6「已由③ 定稿」及最终形状指针（见完成定义）。
