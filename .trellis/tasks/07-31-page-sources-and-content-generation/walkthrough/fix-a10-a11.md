# A10 / A11 缺陷修复说明

阶段三集成走查暴露的两个缺陷，均在独立 worktree 内修复，未提交。

> **worktree 基线提醒**：分派进来时该 worktree 停在 `49816bc`（07-30 桌面设计语言重构的中途
> 快照），**不含任何 M5 提交**。已 `git tag backup-agent-ae692d5f1da94462b` 备份后
> `git reset --hard 6066fc5` 对齐 main。取 diff 时以 `6066fc5` 为基准。

---

## 缺陷 ①：自动放行与人工确认在报告层面无法区分（A10 后半）

### 根因

磁盘层的区分一直是**完整且正确**的：

| | 自动放行页（imported / extracted） | 人工确认页（generated） |
|---|---|---|
| `accept-source` 阶段 | `completed` | `completed` |
| attempt 的 `provider` | `auto-source-trust` | `developer` |
| attempt 的 `assetIds` | `[]` | `["asset-source-acceptance"]` |
| `stages/source/accepted.json` | **不存在** | 存在 |

缺的是**消费端**。`AUTO_SOURCE_TRUST_PROVIDER`（原 `apps/cli/src/slide/workspace.ts:43`）
在全仓只有产生端、零消费端，于是三处报告都表达不了这个区分：

1. `deck status`（结构化 + 人读）：单页对象只有 `sourceKind` / `specEntryId` / `specDrift` / `generation`
2. 桌面端 IPC / 界面：`DeckStatusSlide` 不带该信息，`imported` 页与已确认的 `generated` 页长得一模一样
3. `slide report` 的 `report.json`：顶层无 `source` 键，`manualAcceptance` 只列 clean plate 与 PPTX
   —— 「有人确认过」只能靠**缺席反推**，而缺席同样可能是报告漏写

### 改法

**判据下沉 core，三处消费端共用一个函数**（新增 `packages/core/src/source-acceptance.ts`）：

```ts
export const AUTO_SOURCE_TRUST_PROVIDER = "auto-source-trust";   // 常量随判据一起搬进 core
export type SourceAcceptanceMode = "manual" | "auto" | "pending";
export function resolveSourceAcceptanceMode(manifest): SourceAcceptanceMode;
export const SOURCE_ACCEPTANCE_TEXT = { manual: "人工确认", auto: "按来源自动放行", pending: "待确认" };
```

判定顺序（**顺序不可交换**，理由写在函数注释里）：

1. `accept-source` 非 `completed` → `pending`（`stale` 也算欠着的一次确认）
2. 当前成功 attempt 的 `provider === AUTO_SOURCE_TRUST_PROVIDER` → `auto`
3. 存在**绑到当前 attempt** 的 `source_acceptance` 资产 → `manual`
4. 其余 → `auto`

第 4 条是要害：`normalizeSlideManifest` 给旧 manifest 补出的 `accept-source` 沿用 init 的
attempt（provider 是 `ppt-maker-cli`），若写成「provider 不是 auto 就算人工确认」，
M3/M4 时代的每一页都会凭空长出一条人工痕迹。

资产按 `attemptId` 取而非裸 `role`：换源会把上一代验收记录归档到
`stages/source/archived/<initAttemptId>/accepted.json`，**role 与 attemptId 都不变**，
裸 `find` 会让它冒充当前那份（《跨层契约》〈多代资产与「当前产物」选取契约〉）。

**绝不伪造人工痕迹**：自动放行依旧不写 `accepted.json`；`report.source.acceptedBy` /
`acceptedAt` 只有 `manual` 档才非空。

### 涉及文件

| 文件 | 改动 |
|---|---|
| `packages/core/src/source-acceptance.ts` | **新增**：常量 + 判据 + 文案表 |
| `packages/core/src/index.ts` | 导出新模块 |
| `packages/core/src/report-contracts.ts:31-49` | `SlideReport` 新增顶层 `source` 段 |
| `apps/cli/src/slide/workspace.ts:14,87` | 常量改从 core 导入（原地声明删除） |
| `apps/cli/src/deck/status.ts:73-83,227,334,341-378` | 新增 `sourceAcceptance` 字段 + 人读两行 |
| `apps/cli/src/report/run.ts:154-172,290-296,411-418` | 报告 `source` 段 + 人读一行 |
| `apps/desktop/src/main/ipc/channels.ts:36-43` | `DeckStatusSlide.sourceAcceptance` |
| `apps/desktop/src/renderer/lib/source-view.ts:44-78` | `sourceAcceptanceText` / `sourceSummaryText` |
| `apps/desktop/src/renderer/components/slide/SlideToolbar.tsx:59-67,203-213` | 单页详情正面陈述 |
| `apps/desktop/src/renderer/pages/SourceReviewPage.tsx:434,518-534` | 审片视图页脚加一档 |
| `apps/desktop/src/renderer/components/console/SlideCard.tsx:148,265-277` | 来源徽标 `title` 带确认性质 |

界面遵守 `DESIGN.md`：确认性质是**常态信息**，走 `text-2xs text-ink-muted`，
不上色、不做徽标 —— 「有颜色 = 要你管」的额度留给待办队列与 `StatusChip`。

### 新增测试

`packages/core/test/source-acceptance.test.ts`（8 例，**夹具一律不带 `source` 字段**，
哪一格开始需要来源才算得对，就说明实现又回到了按来源反推）：

- `人工确认：有绑到当前 attempt 的验收记录`
- `自动放行：attempt 带 auto-source-trust 且无验收资产`
- `旧工作区归一化出来的闸门算自动放行，不得报成人工确认`
- `阶段未完成一律待确认`
- `stale 是欠着的一次确认，不因为曾经完成过就报成已确认`
- `换源后归档的旧验收记录不冒充当前那份`
- `缺少 accept-source 阶段状态时为待确认，不抛错`
- `三档齐全，且自动放行档不写成「已确认」`

`apps/cli/test/source-acceptance-report.test.ts`（5 例，新文件）：

- `导入页报自动放行，且磁盘上确实没有 accepted.json`
- `生成页：确认前报待确认并逐页点名，确认后报人工确认`
- `生成页人工确认后换成导入图，报回自动放行且固定路径无 accepted.json`（带前置断言：
  manifest 里确实有一条**归档**的 `source_acceptance`，否则用例可能什么都没覆盖）
- `自动放行页：report.source 明写 auto 且不留任何署名`
- `人工确认页：report.source 带真实签字人与时间`

`apps/desktop/test/*`：六个夹具补两个新字段（无新断言，属类型对齐）。

### 主会话真机复验

```bash
# 前置：core 与 cli 必须先 build
pnpm --filter @ppt-maker/core build && pnpm --filter @ppt-maker/cli build

# 1) 混合来源 deck 的人读输出
node apps/cli/dist/index.js deck status ~/test/wt4-append
```
预期多出两行（末尾）：
```
  源图确认: 人工确认 N，按来源自动放行 M，待确认 K
  待确认源图: page-xx, page-yy（ppt-maker slide accept-source <workspace>）   # 仅 K>0 时出现
```
`~/test/wt4-append` 现为 2 导入旧格式 + 2 导入 + 6 抽取 + 1 生成，
预期「按来源自动放行 10」，生成页那一条按它当时的确认状态落 `manual` 或 `pending`。

```bash
# 2) 结构化输出逐页核对（含与磁盘事实的交叉验证）
node apps/cli/dist/index.js deck status ~/test/wt4-append --json | python3 -c "
import sys, json, os
d = json.load(sys.stdin)
for s in d['slides']:
    p = os.path.join(os.path.expanduser('~/test/wt4-append'), s['workspacePath'],
                     'stages/source/accepted.json')
    print(s['workspacePath'], s['sourceKind'], s['sourceAcceptance'],
          'accepted.json=' + str(os.path.exists(p)))
"
```
**判据**：`sourceAcceptance == 'manual'` ⟺ `accepted.json=True`，一处不符即缺陷复发（A10）。

```bash
# 3) 报告的正面陈述
node apps/cli/dist/index.js slide report ~/test/wt4-append/slides/page-01
python3 -c "
import json; r=json.load(open('$HOME/test/wt4-append/slides/page-01/stages/report/report.json'))
print(r['source'])"
```
预期人读一行含 `来源：imported · 源图按来源自动放行`；
JSON 为 `{'kind': 'imported', 'acceptance': 'auto', 'acceptedBy': None, 'acceptedAt': None}`。
**`acceptedBy` 非空而 `acceptance` 是 `auto`，即为伪造人工痕迹，判缺陷。**

```bash
# 4) 桌面端（由主会话在真机上走查）
```
- 单页复核页工具栏：页名与「第 N/M 页」右侧新增一行灰色小字，如 `导入 · 按来源自动放行`
- 源图审片视图页脚：`生成 · 人工确认 · 规格条目 entry-001`
- 控制台卡片：鼠标悬停左上角来源徽标，tooltip 为 `导入 · 按来源自动放行`

### 已知边界（本轮不处理）

- `report.json` 的 `providerCalls` 仍不带 `attemptId` —— 按协调者要求交由后续另一批修复，
  本轮**未触碰** `apps/cli/src/report/run.ts` 的 `providerCalls` 构造块。
  但「报告要有 `source` 段」这条必然要改这个文件，所以本轮对它做了**两处外科式增补**
  （读取 `sourceAcceptance` 的 21 行 + 输出 `source` 段的 6 行 + 人读一行），
  与 `providerCalls` 无重叠，合并时冲突面为零。
- `manualAcceptance` 段未动：它是「人工接受区」，把自动放行塞进去是范畴错误。
  新增的是独立的顶层 `source` 段。
- `SlideReportSchema` 新增了一个**必填**键。已 grep 确认全仓只有写入方解析它
  （`apps/cli/src/report/run.ts:250`），磁盘上的旧 `report.json` 无人读回，
  重跑 `slide report` 即得新结构，不需要迁移。

---

## 缺陷 ②：`imported` → `generated` 的换源路径不存在（A11 正向）

### 根因

`runDeckRegenerate` 的第一道门禁（原 `apps/cli/src/deck/regenerate.ts:116-122`）：

```ts
if (workspace.manifest.source.kind !== "generated") {
  throw new FoundationError("INVALID_INPUT",
    `只有生成来源的页可以重新生成，该页来源是：${workspace.manifest.source.kind}`);
}
```

而 `deck replace-source` 只收图片文件、产出的来源恒为 `imported`。两者相加的结果是：
**一页一旦从 `generated` 换成 `imported`，就再也回不到 `generated`。**

这与 `design.md` §4.5〈换源后的重新判定〉直接相悖：
> 换源统一走一条路径，而这条路径**按新来源**决定是否需要重新确认，不需要为「重新生成」单开分支。

桌面端有对称的一半：`sourceReviewReachable` = `generatedSource(slide) || !sourceAccepted(slide)`。
换成 `imported` 后自动放行 → 两支都为假 → 审片视图不可达 → 长在那里的「重新生成」按钮
在界面上彻底消失。只修 CLI 不修这里，桌面端仍然回不去。

### 改法

门禁换掉的**不是「放宽」，而是换一个真正的前提**：能不能无歧义地确定规格条目。

新增 `resolveRegenerableSpecEntryId()`（`apps/cli/src/deck/generate-page.ts:315-380`），
判据全部取磁盘事实：

1. 当前来源是 `generated` → 用它自己的 `specEntryId`
2. 否则回看历史：按 `attempts` **倒序**找 init attempt，取第一份读得出来的
   `stages/init/<attemptId>/content-spec.json`（每次生成留下的不可变快照，design §6.1），
   读其 `entry.specEntryId`。这不是推测 —— 那份文件就是「这一页上次按哪条规格出的图」
3. 一份都没有 → `null`，**要求显式 `--spec-entry <id>`，并在错误里列出可用条目**。不猜

倒序遍历 `attempts` 而非资产数组：attempts 是追加写入的，顺序即时间序；
资产数组经过换源归档的重排后不再保证时间序。

其余一行未改 —— `replaceSlideSource` 已经承担了失效级联、产物归档、`accept-source`
按新来源重判。换回 `generated` 后 `buildSourceGate` 返回空，`accept-source` 停在
`invalidateStageAndDownstream` 打出的 `stale`，`init` 保持 `completed`。

> **关于「转 pending」**：分派要求写的是 `accept-source` 转 `pending`，实现给出的是 `stale`。
> 这是**刻意保持与既有 generated→generated 重生成路径一致**：`stale` 携带
> `invalidationReason`（「换源：源图已替换」），改写成 `pending` 会抹掉这条追溯信息，
> 且要为换源单开一条与 `invalidateStageAndDownstream` 并行的状态写法。
> 对外可观测行为完全满足「回到待确认」：`resolveSourceAcceptanceMode` 把非 completed
> 一律判为 `pending`，`deck status` 显示「待确认」，桌面端 `awaitingSourceConfirm` 为真、
> 该页进待办队列。

桌面端：`generatedSource` → `regenerableSource`（判据落在 `regenerableSpecEntryId` 上），
`sourceReviewReachable` 随之改用它。新增 `DeckStatusSlide.regenerableSpecEntryId`
（与 `specEntryId` **分开两个字段**：后者答「当前这张图按哪条规格出的」，
前者答「能不能重出图、用哪条」；合成一个会让这条路重新消失）。

### 涉及文件

| 文件 | 改动 |
|---|---|
| `apps/cli/src/deck/generate-page.ts:311-379` | **新增** `resolveRegenerableSpecEntryId` |
| `apps/cli/src/deck/regenerate.ts:31-40,54,134-175,226,237-241` | 门禁替换 + `specEntryId` 入参 + `previousSourceKind` 出参 + 错误列可用条目 |
| `apps/cli/src/index.ts:636-682` | `--spec-entry <id>` + 命令描述改写 |
| `apps/cli/src/deck/status.ts:86-94,229-232` | `regenerableSpecEntryId` 字段 |
| `apps/desktop/src/main/ipc/channels.ts:45-53` | 同上，IPC 侧 |
| `apps/desktop/src/renderer/lib/accept-gate.ts:107-158` | `generatedSource` → `regenerableSource` |
| `apps/desktop/src/renderer/lib/source-review-nav.ts:39-42,78-80` | 序列项带上两个新字段 |
| `apps/desktop/src/renderer/pages/SourceReviewPage.tsx:424-433,557-580` | `canRegenerate` 判据 + 按钮文案说明会换回生成来源 |

**桌面端没有新增按钮或模态** —— 这是刻意的，也是子任务④「不得三次零散增补」的直接遵守：
入口就是已有的「源图审片 → 重新生成」，只是把它的可达判据修对。新加一个「换成生成来源」
的独立入口，等于给同一件事造第二个界面词汇。

### 新增测试

`apps/cli/test/deck-regenerate.test.ts` 新增 `describe("换源为生成来源（A11 正向）")`：

- `换成导入图的页能换回生成来源，并重新回到待确认`
  （带前置断言确认确实处在缺陷现场；断言 `init` 保持 completed、`accept-source` 非 completed、
  `deckStatus` 报 `pending`、说明写回规格条目、**page-02 的 manifest 逐字节未变**）
- `从未生成过的导入页必须显式给 --spec-entry，错误里列出可用条目`
- `显式给了规格里不存在的条目时报错并列出可用条目`

`apps/desktop/test/accept-gate.test.ts`：

- `regenerableSource 只看有没有规格条目，不看当前来源`
- `换源成 imported 但历史上生成过的页仍可达（能换回生成来源）`
- 恒等式用例扩成「阶段组合 × 三种来源 × 两档规格条目」，覆盖
  「来源不是 generated 但有条目」这一格

### 主会话真机复验

```bash
pnpm --filter @ppt-maker/core build && pnpm --filter @ppt-maker/cli build

# 0) 找一个 generated 页（~/test/wt4-append 的第 11 页）
node apps/cli/dist/index.js deck status ~/test/wt4-append --json | python3 -c "
import sys, json
for s in json.load(sys.stdin)['slides']:
    print(s['workspacePath'], s['sourceKind'], s['sourceAcceptance'],
          s['specEntryId'], s['regenerableSpecEntryId'])"
```
预期 generated 页两个 spec 字段同值；imported / extracted 页两者皆 `None`。

```bash
# 1) generated → imported（反向，此前已通）
node apps/cli/dist/index.js deck replace-source ~/test/wt4-append page-11 <某张16:9图>
node apps/cli/dist/index.js deck status ~/test/wt4-append --json | python3 -c "
import sys, json
s = [x for x in json.load(sys.stdin)['slides'] if x['workspacePath'].endswith('page-11')][0]
print(s['sourceKind'], s['sourceAcceptance'], s['specEntryId'], s['regenerableSpecEntryId'])"
```
预期 `imported auto None entry-xxx` ——
**`regenerableSpecEntryId` 非空是本次修复的关键新增**，它是回程存在的证据。

```bash
# 2) imported → generated（正向，本次修复；会真实计费）
node apps/cli/dist/index.js deck regenerate ~/test/wt4-append \
  --page page-11 --note "复验 A11 正向" --confirm-upload
```
预期 stdout 含：
```
已重新生成 page-11（entry-xxx，init-00N）
来源已由 imported 换回 generated
失效阶段：...
新源图需人工确认后才会继续下游：ppt-maker slide accept-source
```
（此前此处必然是 `错误：只有生成来源的页可以重新生成，该页来源是：imported`，退出码 1。）

```bash
# 3) 状态回到待确认，且只影响本页
node apps/cli/dist/index.js deck status ~/test/wt4-append --json | python3 -c "
import sys, json
for s in json.load(sys.stdin)['slides']:
    print(s['workspacePath'], s['sourceKind'], s['sourceAcceptance'])"
python3 -c "
import json
m = json.load(open('$HOME/test/wt4-append/slides/page-11/manifest.json'))
print({s['stage']: s['status'] for s in m['stages'] if s['stage'] in ('init','accept-source','ocr')})
print('source =', m['source']['kind'])
print('revisionNotes =', json.load(open('$HOME/test/wt4-append/content-spec.json'))['entries'])"
```
预期：page-11 为 `generated pending`；`init=completed`、`accept-source=stale`、`ocr=stale`（或 pending）；
**其余 10 页的 `sourceAcceptance` 与阶段状态零变化**；调整说明已追加进该条目的 `revisionNotes`。

```bash
# 4) 从未生成过的导入页：必须报错要 --spec-entry，绝不猜
node apps/cli/dist/index.js deck regenerate ~/test/wt4-append --page page-01 --confirm-upload
```
预期退出码 1，stderr：
```
错误：无法确定该页要用哪个规格条目（当前来源 imported，且没有任何一次生成快照）；请用 --spec-entry 显式指定。当前规格可用条目：entry-001, entry-002, ...
```

```bash
# 5) 桌面端（真机走查）
```
- 打开 page-11（第 1 步换成 imported 之后、未 regenerate 时）→ 单页工具栏应出现
  **「源图审片」** 按钮（修复前不出现）
- 点进审片视图 → **「重新生成」** 按钮在（修复前不在），
  hover 提示为 `按规格条目 entry-xxx 重新出图，这一页的来源会换回「生成」`
- 点两次执行后提示：`已带调整说明重新生成，说明已写回规格条目；这一页的来源已换回「生成」`
- 该页随即进入待办队列的「待确认源图」组

### 已知边界（本轮不处理，需主会话知悉）

1. **纯导入页在桌面端仍无法换成生成来源。** 从未生成过的页 `regenerableSpecEntryId` 为
   `null`，审片视图不可达，桌面端拿不到「选哪条规格条目」的入口。
   理由：选条目是**内容决策**（哪一页对应哪条规格），属 M6「内容策划工作台」的范畴；
   为它现在造一个条目选择模态，就是子任务④ 明令禁止的零散增补。
   CLI 的 `--spec-entry` 覆盖了这个场景，A11 走查用的「generated ⇄ imported 来回换」
   全程有历史快照，不受影响。
2. **非生成页被人工失效 `accept-source` 后无法重新确认。** `runAcceptSource` 按
   `requiresSourceAcceptance` 拒绝非生成来源，而桌面端 `awaitingSourceConfirm` 为真、
   工具栏会显示「确认源图」——**点下去会报错**。这是既有缺陷，非本轮引入，也不在 A10/A11
   范围内。`resolveSourceAcceptanceMode` 已按「入口打开后无需再改」的方式写好。

---

## 验证结果

```
pnpm --filter @ppt-maker/core build   ✅
pnpm --filter @ppt-maker/cli build    ✅
pnpm format:check                     ✅ Checked 246 files, no fixes applied
pnpm -r typecheck                     ✅ core / cli / desktop 三项均 Done
pnpm -r test                          ✅
```

| 包 | 基线 | 本轮 | 增量 |
|---|---|---|---|
| `packages/core` | 103 | **111** | +8（新文件 `source-acceptance.test.ts`） |
| `apps/desktop` | 466 | **467** | +2 −1（`generatedSource` 用例被 `regenerableSource` 取代） |
| `apps/cli` | 163 | **171** | +8（新文件 5 + `deck-regenerate` 3） |
| **合计** | **732** | **749** | **+17** |

### 环境前置（换机器时会踩）

本 worktree 初始只有源码，跑测试前需要：

```bash
pnpm install --frozen-lockfile
pnpm --filter @ppt-maker/core build
pnpm build:vision   # 缺它 apps/desktop 的 deck-runner.test.ts 2 例失败
pnpm build:pdf      # 缺它 apps/cli 的 pdf-extract.test.ts 10 例失败
```

这 12 个失败与本轮改动无关，纯粹是原生二进制没编。
