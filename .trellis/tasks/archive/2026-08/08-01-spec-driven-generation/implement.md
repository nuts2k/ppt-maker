# 子任务③ 执行计划

顺序按依赖排。每一步的验证列在该步内；全量验证命令见文末。

## 阶段一：core 契约（其余全部依赖它）

- [x] 1.1 新建 `packages/core/src/content-spec-contracts.ts`：`ContentSpec` / `ContentSpecEntry`
      zod schema（形状见 `prd.md`），含 `specEntryId` 唯一性 `superRefine`、
      `items` 非空且不含换行的约束（design §2.2）。
- [x] 1.2 实现 `specViewFingerprint(style, entry)`（design §2.3）：按 schema 显式列字段
      喂 `sha256Values`，带 `group:` / `item:` 等前缀标签防碰撞。
      **不做通用 canonical JSON。**
- [x] 1.3 扩展三处闭合枚举（design §7）：`WorkspaceAsset.role` 追加
      `content_spec` / `generation_prompt`；`ProviderCallRecord.stage` 追加 `init`；
      `provider` 由 `z.literal("openai")` 放宽为 `z.enum`。
      **放宽前先 grep 确认无消费方依赖「该值必为字面量 openai」做类型收窄。**
- [x] 1.4 从 `index.ts` 导出新契约与指纹函数。

验证：`pnpm --filter @ppt-maker/core build && pnpm --filter @ppt-maker/core test`。
用例覆盖 C1：改一条条目只有该条目指纹变；改 `style` 全部条目指纹变；
JSON 键重排不改变指纹。

## 阶段二：生成 Provider 与提示词

- [x] 2.1 接入既有 `generatePageImage()`（`providers/openai-image.ts:198`，现无调用点）。
      不新写调用封装。
- [x] 2.2 实现提示词构造（design §3.2）：英文骨架 + 中文文字内嵌引号（沿用 M2 已验证写法），
      `revisionNotes` 全部拼入并带引导语（E4）。`promptVersion` 常量化为 `m5-generate-v1`。
- [x] 2.3 落 `generation_prompt` 资产（全文）与 `provider_record`；
      `GeneratedSource.promptSha256` 只存指纹。

验证：fake generator 的单测，断言提示词含全部 notes 与引导语、含每个 label 与 item。

## 阶段三：`deck generate`

- [x] 3.1 规格复制进 deck（`<deck>/content-spec.json`），逐条目串行生成建页（design §3.1）。
      `createSlideWorkspace` 传 `source`（generated draft）与 `referencePath`（展平文字）。
- [x] 3.2 断点续跑：已存在且 `specEntryId` 匹配的页跳过；单页失败不中断整批，
      退出码按「至少建立一页」不视为失败。
- [x] 3.3 落 `content_spec` 资产，内容是**合并视图** `{style, entry}` 而非裸条目（design §2.4）。
- [x] 3.4 CLI 注册 `deck generate --spec <file> --deck <path> [--confirm-upload]`。
      **deck 不存在则创建，存在则按页序追加末尾**，既有页零改动、`page-NN` 不重排
      （与子任务② 的 `deck extract` 同构，design §3.1）。

验证：C2 / C3 / C4 / **C14**。**C3 须显式断言资产尺寸与磁盘 PNG 实际像素逐字节一致**，
不接受「等于请求参数」——RK1 已证明网关不返回请求尺寸。

## 阶段四：`reference_text` 缺口（R9，必须早于阶段五）

- [x] 4.1 `ReplaceSlideSourceOptions` 增加可选 `referencePath`（design §4）：
      写新 `reference_text` 资产、更新 `config.referenceTextPath` 与
      `manifest.referenceTextAssetId`、**新 sha 计入 `inputFingerprint`**。
- [x] 4.2 不给 `referencePath` 时行为与现状完全一致（`imported` 换源不受影响）。

⚠️ **高风险文件**：`slide/replace-source.ts` 刚在①修完四个必现缺陷，
改动必须跑该文件既有全部用例，且不得改动归档/失效/闸门重判的顺序
（① 的教训：来源重判必须排在失效之后，失效起点是 `accept-source` 而非 `init`）。

验证：现有换源用例全绿 + 新增「带新参考文本换源后指纹变化且旧 reference 资产保留」。

## 阶段五：`deck regenerate`

- [x] 5.1 `--page N --note "..."`：机械追加 note 回写条目 → 新指纹构造提示词 → 生成 →
      `replaceSlideSource`（带新的 `referencePath`）。
- [x] 5.2 `specEntrySha256` 用**追加 note 之后**的指纹，否则刚生成完就显示漂移。

验证：**C5 是本阶段的核心，覆盖形状不可简化**——取一页跑完完整链路到 `accept-pptx` 的页，
重生成后**继续跑 ocr → review → mask → pptx 成功**。只验到「重生成成功」不算通过。
另加 C6（三次重生成后三条 notes 按序全在）。

## 阶段六：漂移检测与对账

- [x] 6.1 派生计算漂移（design §5），在 `deck status` 呈现。不落盘、不改任何阶段状态。
- [x] 6.2 `deck generate` 重跑对账，报告【新增 / 失联 / 漂移】三类（E3）；
      只自动生成新增条目对应的页，失联页原封不动。
      **对账只覆盖 `source.kind === "generated"` 的页**——混合 deck 里的
      `imported` / `extracted` 页没有 `specEntryId`，不参与对账，
      否则跑一次就会把它们全报成「失联」（C14）。
- [x] 6.3 按 design §6 实现 `content_spec` / `generation_prompt` 的当前产物选取：
      按 `attemptId === initStage.lastSuccessfulAttemptId`。**禁止裸 `role` 查找。**

验证：C8（改条目只该页漂移、所有页阶段状态不变、改回消失；改 style 全部漂移）、
C10、**C9（fixture 须先断言该 role 恰好 3 条，否则用例可能什么都没覆盖）**。

## 阶段七：`deck spec-draft`

- [x] 7.1 `--from <文本文件> -o <file>`：`responses.parse` + `zodTextFormat(ContentSpecSchema)`
      一次调用输出完整规格（E5），含分页、每页 `textGroups`/`visualIntent`、deck 级风格段。
      照 `providers/openai-text-assist.ts:64` 的既有模式。
- [x] 7.2 中文提示词（与仓库既有 Provider 一致）。无对话、无多轮。

验证：C11。

## 阶段八：验收走查

- [x] 8.1 C13 既有工作区零影响：在 `~/test/ppttest-2026-07-25` 的**副本**上验
      （该目录是基线，不在其本身上跑）。**不接受仅凭 fixture 推断。**
- [x] 8.2 C7 溯源完整走查。
- [~] 8.3 **C12 跨页风格一致性实证**（E1 的兑现，最大回滚点）：同一规格实生成 3–4 页，
      人工走查判定。结论依赖人工质量，按《验收覆盖思考指南》**只能标 `[~]` 并写明代劳处**。
      不达标则记录现象并回父任务议参考图方案，**不在实现里自行改方案**。
- [x] 8.4 逐条勾 C1–C13，标 `[~]` 的写明原因。

## 全量验证命令

```bash
pnpm --filter @ppt-maker/core build    # 必须先，dist 不入库
pnpm typecheck
pnpm test
pnpm format:check                      # 本仓库无 lint 脚本，风格检查是这条
```

云调用走查需要 `OPENAI_API_KEY`（`.env` 已配，走第三方网关），
由开发者显式触发，遵循既有 `--confirm-upload` 约定。

## 风险与回滚点

- **C12 不达标**是最大回滚点。此时其余部分均可交付，规格只需追加可选字段，
  已冻结结构不必推翻（这正是 E1 选风格段的核心理由）。
- **`slide/replace-source.ts` 是高风险文件**（阶段四）：① 刚在此修完四个必现缺陷。
  改动后必须跑该文件既有全部用例。
- **`provider` 枚举放宽**是唯一的非追加式变更，实现前先 grep 消费方。
- **契约漂移**：若实现中发现 `SlideSource` / 阶段图需要改动，回父任务改，
  不在③ 内微调（父任务 design §5 明文要求）。

## 完成定义

- C1–C13 逐条验证，`[~]` 项写明代劳处与不受影响的结论范围。
- 全量验证命令通过。
- 规格形状定稿并在父任务 `design.md` §6 回写「已由③ 定稿」及最终形状指针。
