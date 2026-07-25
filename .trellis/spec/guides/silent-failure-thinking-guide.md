# 静默失败诊断指南

> **用途**：当用户报告「点了没反应」「不知道跑没跑」「卡住了」时，用它定位真正的失败点。

---

## 为什么需要这份指南

M4 端到端走查一次性暴露 7 个缺陷，其中 5 个的用户可见表现**完全相同**——点击后界面毫无变化。但根因分散在四个不同层次：

| 表现 | 真实根因 | 所在层 |
|---|---|---|
| 单页复核打开后空白 | 读取路径少一层目录，`catch { return null }` 吞掉 | main IPC |
| 「运行此页」纹丝不动 | 续跑起点计算死锁，永不回头校验 | main 编排 |
| 验收界面说缺产物 | 产物齐全，store 是进页那一刻的快照 | renderer 状态 |
| 「重跑」点 6 次无反应 | 阶段仍是 completed，被幂等跳过（毫秒空转） | CLI 编排 |
| report「运行没反馈」 | 跑成功了但不写状态，UI 永远显示未完成 | CLI 落库 |

**共同特征：失败或无效被静默吞掉，没有任何一层发出声音。** 凭猜测逐层排查代价极高，必须靠证据。

---

## 诊断顺序（严格按此顺序，不要跳步）

### 第 1 步：先分清「没跑」还是「跑了但没效果」

**看活动日志的时间戳**（`~/Library/Application Support/@ppt-maker/desktop/activity/*.jsonl`）：

```bash
tail -30 ~/Library/Application\ Support/@ppt-maker/desktop/activity/*.jsonl | python3 -c "
import sys,json
for line in sys.stdin:
    if line.strip().startswith('{'):
        d=json.loads(line)
        print(f\"{d['at'][11:19]}  {d['kind']:14} {d.get('stage') or '-':16} {d['result']:8} {d.get('detail','')}\")
"
```

| 日志特征 | 结论 |
|---|---|
| 完全没有 `run-start` | 事件没发出——查 UI 事件绑定、`disabled` 条件、前置 return |
| `run-start → page-done` 在**同一秒内**，且**没有任何 `stage-start`** | **所有阶段被跳过**——查阶段状态是否还是 `completed`（见下方「幂等跳过」） |
| 有 `stage-start` 但无后续 | 真的卡在某阶段——查该阶段的外部调用与超时 |
| `stage-complete ... success` 却反复出现同一阶段 | **跑成功了但状态没落库**——查该阶段收尾是否写了 `stages`/`attempts` |

> 毫秒级完成 ≠ 成功。它多半意味着什么都没做。

### 第 2 步：对照磁盘产物与界面显示

```bash
# 阶段状态
python3 -c "
import json
for s in json.load(open('<workspace>/manifest.json'))['stages']:
    print(f\"  {s['stage']:16} {s['status']}\")
"
# 产物是否真的在
ls <workspace>/stages/<stage>/
```

| 磁盘 | 界面 | 结论 |
|---|---|---|
| 产物齐全 | 说缺产物 | **读取侧问题**——路径错、快照过期、asset role 不匹配 |
| 产物缺失 | 说已完成 | 落库与实际不符——查写盘顺序 |
| 状态 pending | 日志说成功 | 收尾漏写状态 |

### 第 3 步：确认「重跑」的语义是否真的成立

只要阶段状态还是 `completed`，`run-from` 的守卫与 `isStageReusable` 会**双双放行复用**，任何重跑都被静默跳过。显式重跑必须先调 `invalidateSlideStage` 标 `stale`。

详见 [跨层契约 · 阶段落库与强制重跑](../backend/contracts.md)。

---

## 编码期的预防清单

写新阶段或新交互入口时逐条自查：

- [ ] **`catch` 里是否直接吞掉了错误？** `catch { return null }` 会把「文件不存在」和「路径写错」变成同一个结果。至少要能区分。
- [ ] **阶段收尾是否同时写了 `assets` / `stages` / `attempts`？** 漏写 `stages` 的表现就是「跑了但界面没变化」。
- [ ] **新加的「重跑」入口是否需要先失效？** 显式指定起点 = 强制重做，必须失效；无参续跑 = 断点续跑，不该失效。
- [ ] **renderer 的数据是一次性加载还是跟随事件更新？** 如果闸门走事件、数据走进页快照，两者必然不同步。
- [ ] **测试断言落在哪里？** 只断言函数返回值不够——**必须断言落库后的持久状态**。缺陷 6 的 5 个既有用例全部只检查返回内容，因而完全没发现状态从未写入。

---

## 修复静默失败后的必查项

> **修好一个「没反应」，往往会让某个误操作第一次产生真实后果。**

M4 的实例：阶段轨道有 10 个点位横贯顶栏、单击即重跑。修复前误触无害（重跑压根不生效），修复后误触会作废该阶段及全部下游产物、重新调用付费 API。用户随即反馈「不知道在哪操作后会回退到上一阶段」。

所以每次修复后追问一句：**这个操作现在生效了，那误触它的代价是什么？** 代价高就要加确认、缩小点击区域，或提高触发门槛。

---

## 相关

- [跨层契约](../backend/contracts.md) — 阶段落库与强制重跑的完整契约
- [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) — 跨层数据流设计
