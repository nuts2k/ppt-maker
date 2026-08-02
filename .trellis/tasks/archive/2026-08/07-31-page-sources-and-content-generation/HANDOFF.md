# 会话交接：②③ 已归档，子任务④ 待创建

写于 2026-08-01 会话结束时。工作区干净，本轮 5 个提交落在 `main`，**未 push**（领先远程 26 个）。

> 本文件替换了「子任务① 已归档，②③ 待创建」那版。②③ 都已完成并归档，那版描述的状态已全部作废。

## 立刻做这两步

Trellis 活动任务按会话 id 绑定，换会话不会自动指向：

```bash
python3 ./.trellis/scripts/task.py current --source
# 若不是父任务，执行：
python3 ./.trellis/scripts/task.py start .trellis/tasks/07-31-page-sources-and-content-generation

pnpm --filter @ppt-maker/core build     # dist 不入库，typecheck 前必须先 build
```

**不要重新规划父任务**。`prd.md` / `design.md` / `implement.md` 三份齐备，且随 ①②③ 的实现
修订过四处（§5 role 表、§6 换源序列、§6 规格形状指针、implement.md 的 2.1–2.3 结论）。

## 当前状态

| 项 | 状态 |
|---|---|
| 父任务 | `in_progress`，阶段一完成，**阶段二三个子任务全部完成**，阶段三集成验收未开始 |
| 子任务① 页面来源契约与换源 | 已归档 → `archive/2026-08/07-31-page-source-contract/` |
| 子任务② PDF 抽取 | **已归档** → `archive/2026-08/08-01-pdf-page-extraction/`，P1–P12 通过 |
| 子任务③ 图片生成 | **已归档** → `archive/2026-08/08-01-spec-driven-generation/`，C1–C14 通过 |
| 子任务④ 桌面端入口收口 | **尚未创建**，依赖已解除 |
| 测试 | **625 项全绿**（core 103 + desktop 359 + cli 163） |

本轮 `main` 上的提交：

```
c876570 feat(m5): 内容规格驱动的图片生成（子任务③）
653820e feat(m5): PDF 逐页抽取为 16:9 页面（子任务②）
984b007 docs(spec): 沉淀 M5 ②③ 的两条教训，并回写父任务
b65101e test(cli): 抬高 testTimeout 修掉并跑时的随机超时
（+ 归档提交）
```

## 下一步：创建子任务④

```bash
python3 ./.trellis/scripts/task.py create "桌面端新建来源入口收口" --slug desktop-source-entry \
  --parent 07-31-page-sources-and-content-generation
```

ROADMAP 的 M5 小节写了计划 slug（不带日期前缀），创建后目录名会带 `MM-DD`，届时回填实际目录名。

## ④ 的范围：父任务已定、不得改动的四条

来自 `implement.md` 的 2.4：

- **实现前必读 `DESIGN.md`**（项目 CLAUDE.md 的硬约束：所有前端视觉设计必须遵从它）。
- **统一设计「新建 deck 时选来源」，不做三次零散增补。** 三种来源现在都齐了，这是唯一一次
  能一把设计干净的机会；分三次加会长成三个并列按钮加三条各不相同的表单。
- **含批量源图确认界面**：批量生成后逐张接受 / 重新生成。
  生成图不满意的概率高，**这个界面的效率直接决定 `generated` 来源好不好用**。
- 桌面端呈现归 ④ 独占：②③ 都刻意只保证「数据落盘可读」，没做任何界面。

## ②③ 交付了什么——④ 要消费的数据面

全部已落盘可读，④ 原则上不需要新增任何 core 契约。

| 数据 | 位置 | ④ 要做的 |
|---|---|---|
| `deck extract --pdf <file> --deck <path> [--pages 3-8,12]` | `apps/cli/src/pdf/extract.ts` | 新建 deck 时的 PDF 来源入口 |
| `deck generate --deck <path> [--spec <file>] [--confirm-upload]` | `apps/cli/src/deck/generate.ts` | 生成来源入口；**已带 `onProgress` 回调**，逐条目 start / done / fail |
| `deck regenerate --page <label> --note "..."` | `apps/cli/src/deck/regenerate.ts` | 批量确认界面里的「重新生成」 |
| `deck spec-draft --from <文本> -o <file>` | `apps/cli/src/deck/spec-draft.ts` | 由构思文本产出规格初稿的入口 |
| 抽取报告（建立页 + 跳过页 + 结构化 `reason`） | `<deck>/extractions/<ISO>-<docSha8>.json` | A5 要求「落盘且在界面可见」——**界面这一半是 ④ 的活** |
| 规格漂移 `specDrift` | `deckStatus()` 返回，取值 `"in-sync" / "drifted" / "missing" / null` | 在总览逐页标注「当前图基于旧版规格」 |
| 三种 `source.kind` 与各自字段 | `manifest.source` | 逐页显示来源 |

**两个建页命令都是「deck 不存在则创建，存在则追加末尾」**，形态刻意同构。父任务 A2 的交错
混合 deck 就是靠按页序依次调用不同来源的命令实现的——④ 的界面**必须支持往已有 deck 追加**，
不能只做「新建」，否则 A2 走查无法进行。

## 桌面端的起点：已有什么、缺什么

**已有**（子任务① 铺的，直接复用）：

- `apps/desktop/src/main/ipc/deck.ts` 已有 `deck:create`，但**只接一个图片目录**（imported 独苗）。
- 源图确认闸门已全线打通：`shared/stages.ts`、`main/ipc/slide.ts:132`、`main/ipc/channels.ts:125`
  都已按 M5 D6 处理 `generated` 停在 `accept-source`。
- 待办队列已有「待确认源图」组（`renderer/stores/todo-queue.ts`）。

**缺的就是 ④ 的全部工作**：来源选择界面、PDF / 生成两条入口、抽取报告呈现、
漂移标注、批量源图确认界面。

## 必须带进实现会话的判断

**1. 不要在桌面端重写判定。** `requiresSourceAcceptance` 是单点定义（`source-contracts.ts:89`），
16:9 容差在 `geometry.ts:74` / `constants.ts:4`。①②③ 三轮都在守这条线：② 特意把 16:9 判定
留在 TS 侧不下沉进 Swift，防的就是「同一个容差两份实现，改一处忘一处」。

**2. 多代资产禁止裸 `role` 查找。** `content_spec` / `generation_prompt` / `reference_text`
每次重生成各出一份，必然多代。判据见 `.trellis/spec/backend/contracts.md`
〈多代资产与「当前产物」选取契约〉的三类。桌面端 `main/slide-detail.ts` 已有
`currentSourceImageAsset` / `currentSuccessAsset` 两个现成例子，照它们写。
**子任务① 的四个必现缺陷里有三个源于此。**

**3. 抽取报告的 schema 目前在 `apps/cli/src/pdf/report.ts`，不在 core。**
② 刻意没挪——那是改 core 契约，不在②范围。④ 要在桌面端读它，届时**可能**需要挪进 core。
这是 ④ 唯一可预见的 core 改动，动之前先确认真的需要。

**4. 批量确认界面别做成「155 个输入框铺满列表」。** 《静默失败思考指南》有条现成教训：
只读展示是一句隐含断言「这份数据是对的」；启发式给出的断言必须留人工推翻的入口，
但入口不必常驻（点击转编辑既留通道又不铺满界面）。批量源图确认是同型问题。

**5. 修好「没反应」会让误触第一次产生真实后果。** 同一份指南的〈修复静默失败后的必查项〉：
批量重新生成是**付费**操作，误触代价高，要加确认或提高触发门槛。

## 动手前必读

1. `DESIGN.md`（CLAUDE.md 的硬约束）
2. `.trellis/spec/backend/contracts.md` —— 尤其〈多代资产与「当前产物」选取契约〉
3. `.trellis/spec/guides/verification-coverage-thinking-guide.md`
4. `.trellis/spec/guides/silent-failure-thinking-guide.md` —— 前端静默失败的判据都在这
5. `.trellis/spec/frontend/` 全部四份

## ④ 之后：父任务阶段三集成验收

`implement.md` 阶段三的 3.1–3.8 逐条走查 A1–A8，**A2 / A3 / A4 需要真实走查，
不接受仅凭子任务各自的验收结论推断**。②③ 各自的验收只覆盖自己那一半，
**混合 deck 的完整链路还没有人端到端跑过**。

## 已知遗留（都是刻意留的，不是漏的）

- **`ContentSpec.schemaVersion` 绑在宿主 `SCHEMA_VERSION` 上。** 父任务 `design.md` §6 原文
  既说「同源」又说「需要自己的版本轴」，实现取了前者。后果：宿主因自身原因升版时，
  全部既有 `content-spec.json` 会一并校验失败，而它们一个字节都没变。已记进 `contracts.md`
  〈独立可寻址契约文件的版本轴〉。**M6 扩展规格前应先决定是否解绑**，④ 不必处理。
- **C12 的标题装饰逐页不同**：风格段没约束这一层。开发者已判定整体一致性达标、接受该现象。
  将来要收紧属可选字段追加，不必推翻已冻结结构。
- **② 的 P7 复核质量未经人工判断**：链路已跑通到 pptx `passed`，但复核门的 20 个版式文字
  是脚本批量标 reviewed 的，复核质量本身没有人看过。
- **`clean/run.ts:329` 硬编码尺寸**（manifest 记 2048×1152、磁盘实为 1672×941，07-22 至今未修）。
  ②③ 都刻意不夹带，要做单独开一条。
- **`"stages/review/text-blocks.json"` 字面量在 CLI 里 11 处各写一份**（10 个文件）。同样单独清理。

## 环境

- `pnpm typecheck` 前必须先 `pnpm --filter @ppt-maker/core build`。
- **本仓库没有 lint 脚本**，风格检查是 `pnpm format:check`（只覆盖 `apps/*/src`、`apps/*/test`、
  `packages/*/src`、`packages/*/test`，不含 Markdown、Swift 与包根的配置文件）。
  父任务 `implement.md`〈验证命令〉原先写的是不存在的 `pnpm -r lint`，本轮已改正。
- `pnpm build:pdf` / `pnpm build:vision` 编译两个原生二进制，都已挂进 `pnpm build`。
- `.env` 已配 `OPENAI_API_KEY` 与 `OPENAI_BASE_URL`（第三方网关 `dtcpa.nuts2k.eu.org`）。
  RK1 结论**只对这个网关成立**。
- **走查素材**：`~/test/ppttest-2026-07-25` 是 M3/M4 旧格式基线（一律**复制**后验，别在它本身上跑）；
  `~/test/ppttest-archive-fix` 是唯一跑完含云调用完整链路的 deck；
  `~/test/b2-export-strict.pdf` 是真实 PowerPoint 导出件（含矢量文本层）；
  `fixtures/pdf-extraction/` 下有混合宽高比、全非 16:9、加密三份合成 PDF。
- **`apps/cli` 的 `testTimeout` 已设为 30s**（`apps/cli/vitest.config.ts`），不要改回默认值。
  理由与复现判据见 `.trellis/spec/backend/quality-guidelines.md`。
