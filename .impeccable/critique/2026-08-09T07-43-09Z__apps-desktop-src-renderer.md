---
target: apps/desktop/src/renderer (M5+M6 UI)
total_score: 28
p0_count: 0
p1_count: 3
timestamp: 2026-08-09T07-43-09Z
slug: apps-desktop-src-renderer
---
## M5/M6 前端界面设计评审

**Method: dual-agent (A: critique-assessment-a · B: critique-assessment-b)**

**Target**: `apps/desktop/src/renderer/` — M5（页面来源）与 M6（内容策划工作台）新增的全部前端界面

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|------:|-----------|
| 1 | Visibility of System Status | 3 | SourceTaskBar/RunControlBar/空态做得好；单张重生成的付费状态主要藏在 title 里 |
| 2 | Match System / Real World | 3 | 校样台术语贴合；Deck/specEntryId 对偶发用户偏开发者语 |
| 3 | User Control and Freedom | 3 | 返回确认、Esc/取消、提案拒绝好；PlanningPage 删除操作即时无 undo |
| 4 | Consistency and Standards | 3 | 基座统一明显；notice 手拼、history diff side stripe 破规则 |
| 5 | Error Prevention | 3 | 批量生成有确认；单张重生成和删除规格保护不足 |
| 6 | Recognition Rather Than Recall | 3 | Kbd 提示好；SourceReview 箭头键无可见提示，disabled reason 依赖 title |
| 7 | Flexibility and Efficiency | 3 | 键盘流和批量勾选好；PlanningPage 长规格缺搜索/折叠 |
| 8 | Aesthetic and Minimalist Design | 2 | PlanningPage 同屏承载过多工作模式 |
| 9 | Error Recovery | 3 | 错误文案具体；部分场景缺就近恢复动作 |
| 10 | Help and Documentation | 2 | 空态与 hint 够用；无系统性帮助入口 |
| **Total** | | **28/40** | **Good 的下沿** |

### Anti-Patterns Verdict

**LLM 评估**：整体不像 AI 生成——restrained 策略执行坚定。但 PlanningPage:2126/2129 的 `border-l-2 border-proof` 是明确的 side-stripe absolute ban 违规。TopNav 和 PlanningPage 有轻微 eyebrow 余味。

**检测器扫描**：0 findings。

**手工代码审查**：4 处对比度边缘风险（ink-muted on surface-sunken ≈4.49:1），1 处 hover 反馈倒退，1 处 token 外硬编码。

### What's Working

1. 色彩与状态语义一致性：status-spec 统一映射表，"有颜色 = 要你管"稳定落地
2. 基座组件方向正确：Segmented radiogroup + roving tabindex，Button 完整六态，IconButton 强制 aria-label
3. "不确定必须长得像不确定"执行好：SourceTaskBar 不渲染空条但渲染 running/blocked/error，Console 空态有三条明确入口

### Priority Issues

#### [P1] PlanningPage 触犯 side-stripe absolute ban
PlanningPage.tsx:2126/2129 用 border-l-2 区分 history before/after。改为完整 border + bg-proof-wash 或内联标签。

#### [P1] PlanningPage 同屏任务过多，主行动竞争
对话/历史、规格编辑器、规格影响、建页/重生成、提案 review 同时呈现。应拆为 mode 或 progressive layers。

#### [P1] 单张重新生成的付费确认不够可见
SourceReviewPage.tsx:575-594 用二次点击 + title。键盘用户看不到 title。应显示可见费用文案。

#### [P2] ink-muted on surface-sunken 对比度不达 4.5:1（4 处）
#6c6c6c 在 #ededed 上约 4.49:1。surface-sunken 上应改用 ink-secondary。

#### [P2] 六态要求未完全覆盖所有交互基座
IconButton、MenuItem、Field、Segmented 缺少部分状态。应逐组件决定并补齐或标注不适用。

### Persona Red Flags

**Alex (Power User)**：PlanningPage 30+ 条规格无搜索/折叠/批量编辑。SourceReview 箭头键无可见提示。

**Riley (Stress Tester)**：EntryEditor 删除即时无 undo。"读不到源图"缺恢复动作。ProposalDecisionWriteFailure 无可操作下一步。

**Sam (Accessibility)**：多个 disabled reason 依赖 title 对键盘不可靠。SourcePicker Panel 初始焦点无可见位置。SourceReview 选中态主要靠 border。

### Minor Observations

- TopNav uppercase tracking-wide 建议收敛
- NoticeBar 基座存在但多页面手拼 notice
- SourcePicker generated 路径可更像 stepper
- 多处计数未覆盖 tabular-nums
- SourceReview 选中项 hover 边框反馈倒退
- variants.ts raised shadow 用内联 rgb

### Questions to Consider

1. 策划页是聊天驱动收敛还是 JSON 编辑器带助手？两者等权时用户每秒都在做选择。
2. 付费生成应否有全应用统一的确认语法？
3. History diff 应像校样批注还是引用块？
4. PlanningPage 一屏只能有一个 proof-red 焦点，谁赢？
