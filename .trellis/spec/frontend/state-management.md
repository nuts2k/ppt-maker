# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

(To be filled by the team)

---

## Common Mistakes

<!-- State management mistakes your team has made -->

> 以下为已由真实缺陷验证的条目；其余章节待补，不预先填写未验证内容。

### 一次性快照与事件驱动混用，两条链路必然不同步

**症状**：验收界面提示「缺少原图或去字底板，无法对比」，但产物在磁盘上齐全。

**成因**：同一个界面里，两类数据走了两条不同的更新链路——

| 数据 | 更新方式 | 结果 |
|---|---|---|
| 验收闸门 | 订阅 run-store 事件 | 流水线跑完立即到位 |
| 底图/底板 | `loadSlide` 一次性加载，`useEffect` 只依赖 `workspacePath` | 进页时 clean 尚未产出取到 `null`，跑完后路径没变、effect 不重跑，**永远停在进页那一刻的快照** |

于是出现「闸门到了、图没到」的矛盾态。

**修法**：让产物数据也跟随执行生命周期刷新。在本页执行结束（`pageBusy` 由 `true` 落回 `false`）时重新拉取：

```tsx
const prevPageBusy = useRef(false);
useEffect(() => {
  if (prevPageBusy.current && !pageBusy) void reloadImages();
  prevPageBusy.current = pageBusy;
}, [pageBusy, reloadImages]);
```

**两个关键细节**：

1. **不要复用整体加载函数**（此处的 `loadSlide`）——它会重置文档态并清 `dirty`，吞掉用户未保存的编辑。应另写只刷产物、不碰编辑态的 action。
2. **异步加载要有切页竞态守卫**，否则加载途中切页会把上一页的数据写进新页：

```ts
const { workspacePath } = get();
// ...await 若干请求...
if (get().workspacePath !== workspacePath) return;   // 已切页，丢弃本次结果
set({ sourceImageUrl, cleanPlateUrl });
```

**自查**：新增任何「界面数据 + 后台执行」的组合时，问一句——*这份数据在执行结束后会自己更新吗？* 如果它只在挂载时加载，而旁边的状态走事件驱动，两者一定会脱节。

**相关**：[静默失败诊断指南](../guides/silent-failure-thinking-guide.md)

### 会话层盖住耐久层：不重跑的失效路径必须显式清会话层

**症状**：点「回到文本复核」后，磁盘上六个阶段已全部转 `stale`（失效原因齐备、上游正确保留 completed），阶段轨道却仍是完成态，看不出任何失效。

**成因**：阶段视图是**耐久层打底、会话层覆盖**的派生结果，而 run 结束时刻意保留了本轮的 `liveStages`（卡片轨道要展示本轮结果）。于是上一轮留下的 `completed` 一直盖着刚写入的 `stale`——`stale` 本有专属配色，用户根本没机会看到。

**为什么另一条路径没暴露它**：「从阶段重跑」会立即启动 run，新的 `stage-start` 事件马上覆盖旧值。**只有不重跑的失效路径会一直挂着旧状态**。

**修法**：失效成功后显式清掉该页的会话层状态，两条人工失效路径都要调。纯函数实现，目标页无会话层状态时返回同一引用，避免无谓重渲染：

```ts
// run-reducer.ts
export function withoutSlideLiveStages(state: RunState, slideId: string): RunState;
// 两条人工失效路径均在失效成功后调用
clearLiveStages(slideId);
```

> **注意**「清会话结果」与「清会话阶段」不是一回事。名字相近的 action 各清各的对象，调错了表现为完全没生效。

**自查**：任何「覆盖式派生」（`{...耐久, ...会话}`）都要问一句——*写入会话层的那条链路，什么时候把它清掉？* 如果答案是「等下次事件覆盖」，那么不触发事件的路径就是漏洞。

**测试要点**：断言必须复现完整路径——「run 结束后 liveStages 仍为 completed → 失效并清理 → 视图回落耐久层的 stale」。只断言 reducer 返回值不足以覆盖这个缺陷。

**相关**：[静默失败诊断指南 · 第二类](../guides/silent-failure-thinking-guide.md)

### 开始/结束事件不成对时，会话层的「进行中」永远撤不掉

上一条的同源缺陷，但触发条件完全不同：那条是**外部**把耐久层改了而会话层没跟；这条是会话层自己**收不到收尾事件**。

**症状**（2026-07-29 阶段 E 走查实测两处）：

- 阶段执行失败：错误条已经写着 `clean · UNKNOWN_ERROR: Connection error.`，同一屏的阶段轨道与标题却还是「生成干净底图 · 执行中」；
- 跑到人工门停下：磁盘上 `accept-clean` 是 `stale`，轨道写「验收底图 · 执行中」7/9。第二种是**每一页的正常路径**，比失败常见得多。

**成因**：会话层靠 `stage-start` / `stage-complete` 一对事件维护 `running → completed`，但发事件的那一侧只在阶段**真的执行过**时才回调 `onStageComplete`：

| 情形 | 有 start | 有 complete | 结果 |
|---|---|---|---|
| 正常执行 | ✓ | ✓ | 正确 |
| 阶段抛错 | ✓ | ✗（收敛成 `gate:"error"`，由 `page-done` 带 `stoppedAt` 报出） | 永久 running |
| 停人工门 | ✓ | ✗（起了就 return） | 永久 running |
| 刻意空转的阶段 | ✓ | ✗（不执行也不标 completed） | 永久 running |

叠加「会话层覆盖耐久层」的派生规则，这条假的 `running` 就把 manifest 里真实的 `failed` / `stale` 全压住了。而会话层的状态枚举只有 `running | completed`（失败与失效归耐久层所有），补不出「失败」，**只能撤掉这条覆盖**。

**修法**：在**收尾事件**里按状态清扫，而不是逐个补失败分支：

```ts
// page-done：这一页的执行已经结束，它上面不可能还有阶段在跑
liveStages: withoutRunningLiveStages(snapshot.liveStages, event.slideId),
```

判据取「收尾时还 running」而不是「是不是失败」——前者对上表四种情形一次覆盖完，后者每加一种停法就漏一次。同轮已 `completed` 的保留，卡片轨道仍要展示本轮结果。

**自查**：任何 `start/finish` 成对事件维护的状态，问一句——*有没有哪条路径只发 start 不发 finish？* 只要有一条，就别在各个分支里补，直接在收尾事件里按状态清扫。

**测试要点**：失败路径与人工门路径各一条用例，断言 `liveStages` 只剩本轮 `completed` 的那些。

### 错误条要指名「出问题的阶段」，不是「当前阶段」

**症状**：page-02 的 `mask` 及下游已失效，控制台卡片写「阶段「复核校验」执行失败，需重跑」，待办队列对同一页写「阶段「AI 辅助复核」上游已变更，需重跑」——两处互相矛盾，且都不是真正失效的 `mask`。

**成因**：三处各用各的口径取「哪个阶段有问题」——

- 卡片用 `currentStageView`（第一个未完成的阶段）。`completed, completed, pending, …, stale` 这种常见形态下，它指到那个 pending 上；
- 待办队列直接拼 CLI `computeProgress` 的一对**错位字段**：`currentStage` 是最后一个**已完成**的阶段，`stageStatus` 取的却是**它下一个**阶段的失败态。照字面拼就成了「阶段「已完成的那个」上游已变更」。

**修法**：抽一个共用的判据函数，两处同源取值：

```ts
// 真失败优先、其次失效；都没有则 null
export function blockingStageView(views: readonly StageView[]): StageView | null;
```

**CLI 侧同一判据（2026-08-01 补齐）**：`deck status` 当时仍在用那对错位字段，M5 给
`SLIDE_STAGE_ORDER` 插入 `accept-source` 之后，换源这条高频路径每次都会报出
`失败: page-01 (accept-source)`——指着一个 completed 的阶段，而且正是新加的那个。
判据下沉到 core：

```ts
// packages/core/src/stage-graph.ts —— 纯耐久层的消费方一律调它
export function findBlockingStage(states: readonly WorkspaceStageState[]): WorkspaceStageState | null;
```

`DeckSlideStatus` 随之拆成两个字段：`currentStage`（进度，最后一个已完成阶段）与
`blockingStage`（故障，卡住的那个阶段，无则 `null`）。**合成一个必然要为另一个的语义买单**
——这正是下一条「一个判据兼职两件事」的同型错误。桌面端的 `blockingStageView` 作用在
合并了会话层的展示视图上，两者是同一判据的两个层次，不得各写一套优先级。

错位口径还会**漏报**：失败阶段与最后一个已完成阶段之间夹着 `pending` 时（如
`ocr: pending, review: failed`），它只看「下一个阶段」，于是整页被报成正常进行中。

**顺带的一条措辞约定**：`stale` 不是 `failed`。「失效」是改了上游后的常规路径（保存复核内容就会产生），文案统一为「上游已变更，需重跑」；「执行失败」只留给 `failed` / `interrupted`。都写成失败会把一次正常的「改完了、重跑一下」报成红色故障。

**自查**：同一件事在多处展示时，问一句——*它们是同一个函数算出来的吗？* 不是的话，迟早会各说各话。

### 一个判据兼职两件事：收敛过头与各写一份同样出错，方向相反

**性质**：上一条「同一件事在多处展示，它们是同一个函数算出来的吗」的**镜像**。那条讲
两处各写一份 filter 必然漂移；这条讲把两件**不同**的事收敛进同一个判据，同样出错——
而且出错方式更隐蔽：没有矛盾显示，只是某个能力凭空消失。

**症状**（2026-07-30 真机实测）：一页验收完成后，最终确认页整个不再出现，页内的
「重做底图」随之消失。此后界面上**没有任何办法**重做底图：改文字不触发失效
（`text` 不在 `maskInvalidationProjection` 里），改了再改回去更不行（文档与上次保存
相同，`decideInvalidation` 返回 `null`），只剩 CLI `slide run --from clean`。

**成因**：`accept-gate.ts` 只有一个 `awaitingFinalConfirm`（`pptx` 完成 **且**
`accept-pptx` 未完成），被两个语义不同的消费方共用：

| 消费方 | 它真正要问的 | 单一判据答的 |
|---|---|---|
| 待办队列 | 这页**还欠**一次最终确认吗 | 正确 |
| 单页工具栏「最终确认」档 | 这页的确认页**有内容可看**吗 | 错——验收后即答否 |

「待办」自带「未完成」语义，「可达」不带。把后者绑在前者上，等于宣布**已完成的东西
不能再看**——而重做入口恰恰长在那个页面里。

**修法**：拆成原子判据，两个复合判据都由原子合成，任何一方都不得就地再写一份：

```ts
export function pptxReady(slide): boolean;      // 页面可达：pptx 完成，不看 accept
export function finalAccepted(slide): boolean;  // 已验收：accept-pptx 完成
export function awaitingFinalConfirm(slide): boolean {
  return pptxReady(slide) && !finalAccepted(slide);   // 待办口径，唯一来源
}
```

闸门对象随之带上 `accepted`，让页面能区分「待确认」与「已验收后回看」——**可达不等于
待办**，界面据此收起「完成」、保留重做类动作，而不是靠隐藏整个页面来表达已完成。

**连带必查**：放宽可达性后，那些「闸门非 null 就自动切视图」的 effect 会跟着放宽。
判据要跟着拆：**自动切换用「待办」，入口可见性用「可达」**。不拆的话已验收页每次
进单页都会被弹到确认页，用户还得手动切回来。

**自查**：一个判据有两个以上消费方时，问一句——*它们问的是同一个问题吗？* 把
「有没有内容」和「要不要做」写成同一个函数，迟早有一方要为另一方的语义买单。

**测试要点**：给合成关系上锁，而不是各测各的——遍历若干阶段组合断言
`awaitingFinalConfirm === pptxReady && !finalAccepted`；再补一条回归用例锁住
「已验收页不得重新入队」，否则拆判据时跟错一处，队列会把做完的页永远列成待办。

**但合成关系的锁单独锁不住这条缺陷**（M5 ④ 变异验证实证）。源图侧照此拆出
`sourceReviewReachable` / `awaitingSourceConfirm` 之后做了一次变异：把「可达」退化成
「待办」（即让可达重新兼任待办，正是本条要防的那个错），**恒等式那条断言仍然全绿**——
恒等式只约束「复合 = 原子 && 原子」，退化后它照样成立。转红的只有「已确认的生成页
仍可进入审片视图」那一条。

所以规则是两条，缺一不可：**① 给合成关系上锁；② 另有一条用例直接锁住那个被放宽的
能力本身**（「已完成/已确认的东西仍然进得去」）。第 ① 条防的是拆完之后再被合回去，
第 ② 条防的是拆得不对。只写 ① 等于把「可达 ≠ 待办」这句话写进了注释而不是测试。

### 新增一个「切换维度」的能力，会把既有竞态从不可触发变成常规路径

**性质**：与上面几条不同，这条不是线上踩出来的，是 2026-07-30 加桌面端切换工作区时 review 发现的隐患，经变异测试确认真实存在（去掉守卫后回归用例转红）。记在这里是因为**触发条件的变化本身就是一类风险**，容易在做新能力时整个漏掉。

**背景**：桌面端此前打开 deck 后 `deckPath` 一辈子不变，于是四处「`await` 后无条件 `set`」从来没出过事：

- `deck-store.refreshStatus()` / `refreshSlide()`
- `slide-store.loadSlide()`
- `activity-store.load()`

切换工作区一上线，它们全部变成真实路径：旧 deck 的请求飞在半空时切过去，返回后把旧数据写进新 deck 的界面，**而且完全静默**——界面看着正常，数据是上一个工作区的。

**修法**：给每处补「发请求时的身份 vs 响应到达时的身份」守卫，判据就近取：

```ts
// 有身份字段的，直接比对
const detailed = await window.api.deck.statusDetailed(deckPath);
if (get().deckPath !== deckPath) return;          // 已切换，丢弃

// 没有身份字段的（activity-store 不持有 deckPath），用序号，别为一句守卫去 import 别的 store
const seq = ++listSeq;
const records = await window.api.activity.list(deckPath, limit);
if (seq !== listSeq) return;
```

**两个容易漏的半边**：

1. **失败路径也要守**。迟到的失败若照写 `error`，错误条会指着一个用户已经离开的工作区。
2. **`reset()` 里要一并作废在途请求**。切换后新数据的加载往往由某个 `useEffect` 发出，`reset()` 到新请求之间有一段空档；旧响应正好落在这段里就会被写进去。

**但作废必须按身份，不能按序号一刀切**（2026-08-02 走查实证，就是照上面这段写成 `listSeq += 1` 踩出来的）：

真实时序不是「先 `reset()` 再发新请求」。切换编排是 `openDeck` 落好新 `deckPath` → React 冲刷 effect → **effect 已经发出 `load(新)`** → 才轮到 `resetOtherStores()`。effect 什么时候被冲刷不由切换代码决定，所以这个顺序在调用方那边摆不平。此时 `listSeq += 1` 会把**已经属于新 deck** 的那次请求一并作废，而之后没有任何东西会再发一次：

```ts
// 症状：切完 deck 活动日志抽屉恒为「暂无记录」，磁盘上记录好好的，全程不报错
reset() { listSeq += 1; set({ records: [] }) }     // ✗ 连坐
reset(nextDeckPath = null) { currentPath = nextDeckPath; set({ records: [] }) }   // ✓ 按身份
// load 落地前两个条件都要满足：既是最后一次请求，也属于当前这个 deck
if (seq !== listSeq || currentPath !== deckPath) return;
```

没有身份字段的 store（如 `activity-store` 不持有 `deckPath`）就**让调用方把身份传进来**——`reset(useDeckStore.getState().deckPath)`。这比在日志层 `import` deck-store 更轻，也比一刀切正确。

一句话判据：**「作废在途请求」问的永远是「这条响应属于谁」，不是「它是什么时候发出的」。** 按时间作废，在「新请求早于清零」这个顺序下必然误伤。

**自查**：给系统加「切换 X」的能力时，别只问新代码对不对，先问一句——*现有哪些异步写入是按 X 索引的？它们此前是不是靠「X 不会变」才安全？* 凡是靠这个前提的，全部需要守卫。同理适用于将来加「多窗口」「同时打开两个 deck」。

**测试要点**：用手动控制响应时机的 deferred 复现完整时序（请求发出 → 期间切换 → 迟到响应到达），并给每处守卫配一条**正对照**（不切换时结果必须照常写入），否则守卫写成恒真也能过。写完做一次变异验证：把守卫逐处改成 `if (false)` 重跑，该红的必须红——本次就靠这一步查出一条假通过的用例（两个 deck 用了不同 slideId，`replaceSlide` 找不到便原样返回，守卫失效也看不出来；改成两边同名 `page-01` 后才真正生效）。
