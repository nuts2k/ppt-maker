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
