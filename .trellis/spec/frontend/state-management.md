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

**顺带的一条措辞约定**：`stale` 不是 `failed`。「失效」是改了上游后的常规路径（保存复核内容就会产生），文案统一为「上游已变更，需重跑」；「执行失败」只留给 `failed` / `interrupted`。都写成失败会把一次正常的「改完了、重跑一下」报成红色故障。

**自查**：同一件事在多处展示时，问一句——*它们是同一个函数算出来的吗？* 不是的话，迟早会各说各话。

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
2. **`reset()` 里要一并作废在途请求**（`listSeq += 1`）。切换后新数据的加载往往由某个 `useEffect` 发出，`reset()` 到新请求之间有一段空档；旧响应正好落在这段里，序号没变就会被写进去。

**自查**：给系统加「切换 X」的能力时，别只问新代码对不对，先问一句——*现有哪些异步写入是按 X 索引的？它们此前是不是靠「X 不会变」才安全？* 凡是靠这个前提的，全部需要守卫。同理适用于将来加「多窗口」「同时打开两个 deck」。

**测试要点**：用手动控制响应时机的 deferred 复现完整时序（请求发出 → 期间切换 → 迟到响应到达），并给每处守卫配一条**正对照**（不切换时结果必须照常写入），否则守卫写成恒真也能过。写完做一次变异验证：把守卫逐处改成 `if (false)` 重跑，该红的必须红——本次就靠这一步查出一条假通过的用例（两个 deck 用了不同 slideId，`replaceSlide` 找不到便原样返回，守卫失效也看不出来；改成两边同名 `page-01` 后才真正生效）。
