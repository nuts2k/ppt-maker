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
