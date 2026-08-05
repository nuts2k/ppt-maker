import type {
  ContentSpec,
  ContentSpecEntry,
  PlanningDimensions,
  PlanningMaterialEntry,
  PlanningMessage,
  PlanningProposalPreview,
  PlanningProposalSelection,
  PlanningProposalState,
  SpecChangeRecord,
  StoredPlanningProposal,
} from "@ppt-maker/core";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SourceTaskBar } from "@/components/SourceTaskBar";
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  Panel,
  SegmentedGroup,
  SegmentedItem,
  Textarea,
} from "@/components/ui";
import {
  buildDimensionViews,
  buildProposalConfirm,
  buildProposalDiffSections,
  guardPlanningAction,
  resolvePlanningPrimaryAction,
  resolveProposalMessageStatus,
} from "@/lib/planning-conversation-core";
import {
  buildRegenerateBatchConfirm,
  type CreatePagesSummary,
  classifyOutdatedPages,
  createPagesFlow,
  hasSpecImpact,
  isEmptyChangeRecord,
  pendingEntrySummaries,
  resolveCreatePagesAction,
  selectedPendingEntryIds,
  specActionBlockedReason,
  specImpactEmptyCopy,
  summarizeCreatePages,
} from "@/lib/planning-core";
import { startSourceTask } from "@/lib/source-task";
import { createEmptyPlanningWorkspace } from "@/lib/workspace-switch";
import { useDeckStore } from "@/stores/deck-store";
import { usePlanningConversationStore } from "@/stores/planning-conversation-store";
import { selectPlanningDirty, usePlanningStore } from "@/stores/planning-store";
import { useRunStore } from "@/stores/run-store";
import { useSourceTaskStore } from "@/stores/source-task-store";
import { useUIStore } from "@/stores/ui-store";

export function PlanningPage(): React.JSX.Element {
  const deckPath = useDeckStore((state) => state.deckPath);
  const deckName = useDeckStore((state) => state.name);
  const slides = useDeckStore((state) => state.slides);
  const deckError = useDeckStore((state) => state.error);
  const refreshStatus = useDeckStore((state) => state.refreshStatus);

  const loadedDeckPath = usePlanningStore((state) => state.loadedDeckPath);
  const saved = usePlanningStore((state) => state.saved);
  const draft = usePlanningStore((state) => state.draft);
  const history = usePlanningStore((state) => state.history);
  const loading = usePlanningStore((state) => state.loading);
  const saving = usePlanningStore((state) => state.saving);
  const justCreated = usePlanningStore((state) => state.justCreated);
  const error = usePlanningStore((state) => state.error);
  const lastResult = usePlanningStore((state) => state.lastResult);
  const dirty = usePlanningStore(selectPlanningDirty);
  const load = usePlanningStore((state) => state.load);
  const updateDraft = usePlanningStore((state) => state.updateDraft);
  const save = usePlanningStore((state) => state.save);
  const rollback = usePlanningStore((state) => state.rollback);
  const resetPlanning = usePlanningStore((state) => state.reset);

  const conversationDeckPath = usePlanningConversationStore(
    (state) => state.deckPath,
  );
  const conversation = usePlanningConversationStore((state) => state.snapshot);
  const proposalPreview = usePlanningConversationStore(
    (state) => state.preview,
  );
  const proposalSelection = usePlanningConversationStore(
    (state) => state.selection,
  );
  const conversationScope = usePlanningConversationStore(
    (state) => state.scope,
  );
  const selectedEntryId = usePlanningConversationStore(
    (state) => state.selectedEntryId,
  );
  const conversationOperation = usePlanningConversationStore(
    (state) => state.operation,
  );
  const conversationError = usePlanningConversationStore(
    (state) => state.error,
  );
  const conversationWarning = usePlanningConversationStore(
    (state) => state.warning,
  );
  const lastAcceptResult = usePlanningConversationStore(
    (state) => state.lastAcceptResult,
  );
  const loadConversation = usePlanningConversationStore((state) => state.load);
  const sendMessage = usePlanningConversationStore(
    (state) => state.sendMessage,
  );
  const draftSpec = usePlanningConversationStore((state) => state.draftSpec);
  const proposeChange = usePlanningConversationStore(
    (state) => state.proposeChange,
  );
  const setConversationScope = usePlanningConversationStore(
    (state) => state.setScope,
  );
  const selectConversationEntry = usePlanningConversationStore(
    (state) => state.selectEntry,
  );
  const syncSelectedEntry = usePlanningConversationStore(
    (state) => state.syncSelectedEntry,
  );
  const setProposalSelection = usePlanningConversationStore(
    (state) => state.setProposalSelection,
  );
  const acceptProposal = usePlanningConversationStore(
    (state) => state.acceptProposal,
  );
  const rejectProposal = usePlanningConversationStore(
    (state) => state.rejectProposal,
  );
  const importMaterial = usePlanningConversationStore(
    (state) => state.importMaterial,
  );
  const removeMaterial = usePlanningConversationStore(
    (state) => state.removeMaterial,
  );
  const resetConversation = usePlanningConversationStore(
    (state) => state.reset,
  );

  const backToConsole = useUIStore((state) => state.backToConsole);
  const sourceTaskRunning = useSourceTaskStore((state) => state.running);
  const pipelineRunning = useRunStore((state) => state.status) !== "idle";
  const specWriteBlocked = sourceTaskRunning || pipelineRunning;
  const [summary, setSummary] = useState("");
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(
    new Set(),
  );
  /*
   * 本页发起的那次建页的结果。
   *
   * 不读 store 的 `lastResult`：那是全局最近一次建页任务，控制台的 SourcePicker
   * 跑过一次之后再进策划页，会凭空冒出一条不属于这次操作的完成提示。本地状态只在
   * 这里点了「建立所选 N 页」并拿到受理结果时才写。
   *
   * 被互斥挡下（`accepted: false`）与抛异常两条路都不写这里，各有各的渲染者，
   * 见 `CreatePagesResult` 上的说明。
   */
  const [createResult, setCreateResult] = useState<CreatePagesSummary | null>(
    null,
  );
  const [sidebarView, setSidebarView] = useState<"conversation" | "history">(
    "conversation",
  );
  const [composerText, setComposerText] = useState("");

  useEffect(() => {
    if (
      deckPath !== null &&
      loadedDeckPath !== deckPath &&
      !(justCreated && loadedDeckPath === null)
    ) {
      void load(deckPath);
    }
  }, [deckPath, justCreated, load, loadedDeckPath]);

  useEffect(() => {
    if (
      deckPath !== null &&
      conversationOperation !== "load" &&
      (conversationDeckPath !== deckPath || conversation === null)
    ) {
      void loadConversation(deckPath);
    }
  }, [
    conversation,
    conversationDeckPath,
    conversationOperation,
    deckPath,
    loadConversation,
  ]);

  const editable = draft ?? saved;

  useEffect(() => {
    syncSelectedEntry(editable?.entries ?? []);
  }, [editable?.entries, syncSelectedEntry]);

  const outdated = useMemo(() => classifyOutdatedPages(slides), [slides]);
  const driftedPageLabels = useMemo(
    () => outdated.drifted.map((slide) => slide.pageLabel),
    [outdated.drifted],
  );

  useEffect(() => {
    setSelectedPages(new Set(driftedPageLabels));
  }, [driftedPageLabels]);

  /*
   * 待建条目取 `saved`（磁盘现值）而**不是** `editable`（`draft ?? saved`）。
   *
   * 建页由 CLI 读磁盘上的规格：草稿里新加的条目在磁盘上根本不存在，算进「待建 N 条」
   * 会让付费确认框上的数字大于实际会建出的页数——而那个数字正是付费门槛的全部依据。
   * 脏草稿另有按钮禁用兜底，但两道防线各管一头：这里管数字准不准，那里管能不能点。
   */
  const pendingEntries = useMemo(
    () => pendingEntrySummaries(saved, slides),
    [saved, slides],
  );

  useEffect(() => {
    setSelectedEntries(new Set(pendingEntries.map((e) => e.specEntryId)));
  }, [pendingEntries]);

  async function handleBack(): Promise<void> {
    if (dirty) {
      const confirmed = await window.api.system.confirm({
        title: "放弃未保存的规格草稿？",
        message: "返回控制台将丢弃这次未保存的规格修改",
        detail: "已经保存到磁盘的规格与历史记录不受影响。",
        confirmLabel: "放弃并返回",
      });
      if (!confirmed) return;
    }
    resetPlanning();
    resetConversation();
    backToConsole();
  }

  async function handleSave(): Promise<void> {
    if (specWriteBlocked) return;
    const result = await save(summary);
    if (result === null) return;
    setSummary("");
    if (deckPath !== null) await loadConversation(deckPath);
    await refreshStatus().catch(() => undefined);
  }

  async function handleRollback(record: SpecChangeRecord): Promise<void> {
    if (specWriteBlocked) return;
    const confirmed = await window.api.system.confirm({
      title: "确认回滚规格",
      message: `回到“${record.summary}”发生前的规格状态？`,
      detail: dirty
        ? "你还有未保存的规格草稿，继续将丢弃草稿。回滚是一次新的前进，不抹历史；本次回滚也会追加为一条新记录。"
        : "回滚是一次新的前进，不抹历史；本次回滚也会追加为一条新记录。",
      confirmLabel: dirty ? "丢弃草稿并回滚" : "确认回滚",
    });
    if (!confirmed) return;
    const result = await rollback(record.recordId);
    if (result !== null) await refreshStatus().catch(() => undefined);
  }

  async function handleRegenerate(): Promise<void> {
    if (deckPath === null) return;
    const labels = outdated.drifted
      .map((slide) => slide.pageLabel)
      .filter((label) => selectedPages.has(label));
    if (labels.length === 0) return;
    const confirmed = await window.api.system.confirm(
      buildRegenerateBatchConfirm(labels),
    );
    if (!confirmed) return;

    void startSourceTask(
      { deckPath, createNew: false },
      { kind: "regenerate-batch", pageLabels: labels },
    );
    resetPlanning();
    backToConsole();
  }

  /**
   * 按当前规格把待建条目建成页。
   *
   * 与上面的 `handleRegenerate` 刻意不同：**建完留在本页**，不 `resetPlanning`、
   * 不 `backToConsole`（父任务 D5）。规格产出之后往往还要继续改，自动跳走会把人
   * 从正在做的事里拽出来；「去控制台」留给用户自己点。
   */
  async function handleCreatePages(): Promise<void> {
    if (deckPath === null) return;
    const entryIds = selectedPendingEntryIds(pendingEntries, selectedEntries);
    const result = await createPagesFlow(
      {
        confirm: (options) => window.api.system.confirm(options),
        start: (request) =>
          startSourceTask({ deckPath, createNew: false }, request),
      },
      entryIds,
    );
    // null＝用户取消 / 一条都没勾 / 结果被丢弃（切了工作区），三种都不该留提示；
    // 被互斥挡下由 SourceTaskBar 说，不写进这里
    if (result?.accepted !== true) return;
    /*
     * 结果要配上「用户勾了几条」才说得清楚：CLI 的 `skipped` 把「此前已建过」与
     * 「本次没勾选」混在一起，只看它必然把用户自己取消的勾选说成「已经建过页」
     * （走查实测）。判据在 `summarizeCreatePages`。
     */
    setCreateResult(
      summarizeCreatePages({
        requested: entryIds.length,
        created: result.created,
        failed: result.failed,
      }),
    );
  }

  const pendingProposal = conversation?.session.pendingProposal ?? null;
  const acceptDecisionWriteFailed =
    lastAcceptResult !== null && !lastAcceptResult.decisionWritten;
  const conversationBusy = conversationOperation !== null;
  const actionGuard = guardPlanningAction({
    hasSavedSpec: saved !== null,
    dirty,
    hasPendingProposal: pendingProposal !== null,
    busy: conversationBusy,
  });

  async function handleComposerSubmit(): Promise<void> {
    if (!actionGuard.allowed || composerText.trim() === "") return;
    const sent =
      saved === null
        ? await sendMessage(composerText)
        : await proposeChange(composerText);
    if (sent) setComposerText("");
  }

  async function handleDraftSpec(): Promise<void> {
    if (!actionGuard.allowed) return;
    await draftSpec();
  }

  async function handleAcceptProposal(): Promise<void> {
    if (deckPath === null || proposalPreview === null) return;
    const confirmed = await window.api.system.confirm(
      buildProposalConfirm(proposalPreview),
    );
    if (!confirmed) return;
    const result = await acceptProposal();
    if (result === null) return;
    await Promise.all([load(deckPath), refreshStatus().catch(() => undefined)]);
  }

  async function handleRejectProposal(): Promise<void> {
    await rejectProposal();
  }

  if (deckPath === null || (justCreated && loadedDeckPath === null)) {
    return <CreatePlanningDeck onBack={() => void handleBack()} />;
  }

  const primaryAction = resolvePlanningPrimaryAction({
    hasPendingProposal: pendingProposal !== null,
    hasSavedSpec: saved !== null,
    dirty,
    sidebarView,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-4 border-b border-hairline px-6 py-4">
        <Button variant="ghost" size="sm" onClick={() => void handleBack()}>
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          返回控制台
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-ink">
              内容策划
            </h1>
            {dirty && (
              <span className="rounded-full bg-proof-wash px-2 py-0.5 text-2xs font-semibold text-proof">
                未保存
              </span>
            )}
          </div>
          <p className="truncate text-xs text-ink-muted">
            {deckName ?? deckPath}
          </p>
        </div>
        <Input
          className="max-w-xs"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="概括这次修改（可选）"
          aria-label="变更摘要"
          disabled={saving || editable === null || specWriteBlocked}
        />
        <Button
          variant={primaryAction === "save" ? "primary" : "secondary"}
          onClick={() => void handleSave()}
          disabled={
            !dirty ||
            editable === null ||
            specWriteBlocked ||
            pendingProposal !== null
          }
          loading={saving}
          title={
            pipelineRunning
              ? "流水线正在执行，请停止后再保存规格"
              : sourceTaskRunning
                ? "建页任务正在执行，请等它结束后再保存规格"
                : undefined
          }
        >
          保存规格
        </Button>
      </header>

      {(error !== null || deckError !== null || conversationError !== null) && (
        <div className="shrink-0 border-b border-hairline bg-state-failed/10 px-6 py-3 text-sm font-medium text-state-failed">
          {error ?? deckError ?? conversationError}
        </div>
      )}

      {conversationWarning !== null && (
        <div className="shrink-0 border-b border-hairline bg-state-stale/10 px-6 py-3 text-sm font-medium text-state-stale">
          {conversationWarning}
        </div>
      )}

      {lastResult !== null && (
        <div
          className={
            lastResult.historyWritten
              ? "shrink-0 border-b border-hairline bg-surface px-6 py-3 text-sm text-ink-secondary"
              : "shrink-0 border-b border-hairline bg-state-stale/10 px-6 py-3 text-sm font-medium text-state-stale"
          }
        >
          {lastResult.historyWritten
            ? `规格已保存：新增 ${lastResult.drifted.length} 页过时，${lastResult.missing.length} 页失联。`
            : "警告：规格已保存，但本次改动未能写入变更历史（planning/spec-history.jsonl）；该记录无法在左侧历史面板回看，也无法回滚。"}
        </div>
      )}

      {/* 建页进度、被互斥挡下的理由与执行错误。三样都没有时整条不渲染 */}
      <SourceTaskBar className="shrink-0 px-6 pt-3" />

      <CreatePagesResult
        result={createResult}
        onDismiss={() => setCreateResult(null)}
        onGoConsole={() => void handleBack()}
      />

      <div className="flex min-h-0 flex-1">
        <PlanningSidebar
          view={sidebarView}
          onViewChange={setSidebarView}
          history={history}
          saving={saving || specWriteBlocked}
          onRollback={(record) => void handleRollback(record)}
          messages={conversation?.session.messages ?? []}
          proposals={conversation?.session.proposals ?? []}
          dimensions={conversation?.session.dimensions ?? null}
          materials={conversation?.materials ?? []}
          hasSavedSpec={saved !== null}
          scope={conversationScope}
          selectedEntry={
            editable?.entries.find(
              (entry) => entry.specEntryId === selectedEntryId,
            ) ?? null
          }
          composerText={composerText}
          guardReason={actionGuard.reason}
          busy={conversationBusy}
          pending={pendingProposal !== null}
          composerPrimary={primaryAction === "send"}
          onScopeChange={setConversationScope}
          onComposerChange={setComposerText}
          onSubmit={() => void handleComposerSubmit()}
          onDraft={() => void handleDraftSpec()}
          onImportMaterial={() => void importMaterial()}
          onRemoveMaterial={(name) => void removeMaterial(name)}
        />

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
          {pendingProposal !== null && acceptDecisionWriteFailed ? (
            <ProposalDecisionWriteFailure />
          ) : pendingProposal !== null ? (
            <ProposalReview
              // pending 与它的 before 必须来自同一份会话快照；两个 store 的加载先后不保证。
              before={conversation?.spec ?? saved}
              proposal={pendingProposal.proposal}
              preview={proposalPreview}
              selection={proposalSelection}
              busy={conversationBusy}
              onSelectionChange={(selection) =>
                void setProposalSelection(selection)
              }
              onAccept={() => void handleAcceptProposal()}
              onReject={() => void handleRejectProposal()}
            />
          ) : loading ? (
            <p className="text-sm text-ink-muted">正在读取规格与历史…</p>
          ) : editable === null ? (
            <EmptySpec
              onStart={() => updateDraft((spec) => spec)}
              disabled={specWriteBlocked}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
              <SpecEditor
                spec={editable}
                onChange={updateDraft}
                disabled={saving || specWriteBlocked}
                selectedEntryId={selectedEntryId}
                onSelectEntry={selectConversationEntry}
              />
              <SpecImpactPanel
                pending={pendingEntries}
                drifted={outdated.drifted}
                missing={outdated.missing}
                selectedPages={selectedPages}
                selectedEntries={selectedEntries}
                dirty={dirty}
                running={sourceTaskRunning || pipelineRunning}
                onTogglePage={(pageLabel, checked) =>
                  setSelectedPages((current) =>
                    toggled(current, pageLabel, checked),
                  )
                }
                onToggleAllPages={(checked) =>
                  setSelectedPages(
                    checked
                      ? new Set(
                          outdated.drifted.map((slide) => slide.pageLabel),
                        )
                      : new Set(),
                  )
                }
                onToggleEntry={(specEntryId, checked) =>
                  setSelectedEntries((current) =>
                    toggled(current, specEntryId, checked),
                  )
                }
                onToggleAllEntries={(checked) =>
                  setSelectedEntries(
                    checked
                      ? new Set(
                          pendingEntries.map((entry) => entry.specEntryId),
                        )
                      : new Set(),
                  )
                }
                onCreatePages={() => void handleCreatePages()}
                onRegenerate={() => void handleRegenerate()}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function CreatePlanningDeck({ onBack }: { readonly onBack: () => void }) {
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState<string | null>(null);
  const loading = useDeckStore((state) => state.loading);
  const error = useDeckStore((state) => state.error);

  async function selectParent(): Promise<void> {
    const selected = await window.api.system.selectDirectory();
    if (selected !== null) setParentDir(selected);
  }

  async function create(): Promise<void> {
    if (parentDir === null || name.trim() === "") return;
    await createEmptyPlanningWorkspace(parentDir, name.trim());
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-hairline px-6 py-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          返回控制台
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
        <Panel className="w-full max-w-lg p-6" elevation="raised">
          <h1 className="text-xl font-semibold text-ink">从内容策划开始</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
            先创建一个零页
            Deck，再从一句构思开始，让助手逐步追问并收敛内容规格。
          </p>

          <div className="mt-6 flex flex-col gap-5">
            <label
              htmlFor="planning-deck-name"
              className="flex flex-col gap-1.5 text-sm font-medium text-ink"
            >
              Deck 名称
              <Input
                id="planning-deck-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：季度复盘"
                autoFocus
                disabled={loading}
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">保存到</span>
              <div className="flex items-center gap-2">
                <Input
                  value={parentDir ?? ""}
                  readOnly
                  placeholder="选择父目录"
                  aria-label="Deck 父目录"
                />
                <Button
                  variant="secondary"
                  onClick={() => void selectParent()}
                  disabled={loading}
                >
                  <FolderOpen aria-hidden="true" className="size-3.5" />
                  选择目录
                </Button>
              </div>
            </div>

            {error !== null && (
              <p className="rounded-sm bg-state-failed/10 px-3 py-2 text-sm font-medium text-state-failed">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={() => void create()}
                disabled={parentDir === null || name.trim() === ""}
                loading={loading}
              >
                创建并开始策划
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function EmptySpec({
  onStart,
  disabled,
}: {
  readonly onStart: () => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="flex h-full min-h-72 items-center justify-center">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-ink">
          这个 Deck 还没有内容规格
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          打开工作台不会改写旧工作区。开始编辑后，只有点“保存规格”才会写盘。
        </p>
        <Button
          className="mt-5"
          variant="secondary"
          onClick={onStart}
          disabled={disabled}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          开始编辑规格
        </Button>
      </div>
    </div>
  );
}

function SpecEditor({
  spec,
  onChange,
  disabled,
  selectedEntryId,
  onSelectEntry,
}: {
  readonly spec: ContentSpec;
  readonly onChange: (update: (spec: ContentSpec) => ContentSpec) => void;
  readonly disabled: boolean;
  readonly selectedEntryId: string | null;
  readonly onSelectEntry: (specEntryId: string) => void;
}) {
  function updateEntry(
    index: number,
    update: (entry: ContentSpecEntry) => ContentSpecEntry,
  ): void {
    onChange((current) => ({
      ...current,
      entries: current.entries.map((entry, entryIndex) =>
        entryIndex === index ? update(entry) : entry,
      ),
    }));
  }

  function moveEntry(index: number, delta: -1 | 1): void {
    onChange((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.entries.length) return current;
      const entries = [...current.entries];
      const entry = entries[index];
      const other = entries[target];
      if (entry === undefined || other === undefined) return current;
      entries[index] = other;
      entries[target] = entry;
      return { ...current, entries };
    });
  }

  return (
    <>
      <Panel as="section" className="p-5">
        <h2 className="text-lg font-semibold text-ink">Deck 风格</h2>
        <p className="mt-1 text-xs leading-relaxed text-state-stale">
          风格会拼进每一页的提示词；修改后，全部已生成页都会过时。
        </p>
        <Textarea
          className="mt-4 min-h-28 resize-y"
          value={spec.style.description}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              style: { description: event.target.value },
            }))
          }
          placeholder="描述配色、字体气质、版式和图形语言"
          aria-label="Deck 风格描述"
          disabled={disabled}
        />
      </Panel>

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">页面条目</h2>
            <p className="mt-1 text-xs text-ink-muted">
              每个条目对应一页生成内容；可用上移、下移调整顺序。
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange((current) => ({
                ...current,
                entries: [...current.entries, newEntry()],
              }))
            }
            disabled={disabled}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            添加页面
          </Button>
        </div>

        {spec.entries.length === 0 ? (
          <Panel className="p-5 text-sm text-ink-muted">
            尚无页面条目。添加页面后可填写页型、页面文字和视觉意图。
          </Panel>
        ) : (
          spec.entries.map((entry, index) => (
            <EntryEditor
              key={entry.specEntryId}
              entry={entry}
              index={index}
              total={spec.entries.length}
              disabled={disabled}
              selected={entry.specEntryId === selectedEntryId}
              onSelect={() => onSelectEntry(entry.specEntryId)}
              onChange={(update) => updateEntry(index, update)}
              onMove={(delta) => moveEntry(index, delta)}
              onRemove={() =>
                onChange((current) => ({
                  ...current,
                  entries: current.entries.filter(
                    (candidate) => candidate.specEntryId !== entry.specEntryId,
                  ),
                }))
              }
            />
          ))
        )}
      </section>
    </>
  );
}

function EntryEditor({
  entry,
  index,
  total,
  disabled,
  selected,
  onSelect,
  onChange,
  onMove,
  onRemove,
}: {
  readonly entry: ContentSpecEntry;
  readonly index: number;
  readonly total: number;
  readonly disabled: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onChange: (
    update: (entry: ContentSpecEntry) => ContentSpecEntry,
  ) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  return (
    <Panel
      as="article"
      elevation={selected ? "raised" : "flat"}
      className={selected ? "border-border-strong p-5" : "p-5"}
      onFocus={onSelect}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold text-ink-muted">
            页面 {index + 1}
          </p>
          <p className="truncate text-xs text-ink-muted">{entry.specEntryId}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          selected={selected}
          onClick={onSelect}
          disabled={disabled}
        >
          {selected && <Check aria-hidden="true" className="size-3.5" />}
          {selected ? "当前对话目标" : "设为对话目标"}
        </Button>
        <IconButton
          label="上移页面"
          size="sm"
          variant="ghost"
          onClick={() => onMove(-1)}
          disabled={disabled || index === 0}
        >
          <ArrowUp aria-hidden="true" className="size-3.5" />
        </IconButton>
        <IconButton
          label="下移页面"
          size="sm"
          variant="ghost"
          onClick={() => onMove(1)}
          disabled={disabled || index === total - 1}
        >
          <ArrowDown aria-hidden="true" className="size-3.5" />
        </IconButton>
        <IconButton
          label="删除页面"
          size="sm"
          variant="ghost"
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
        </IconButton>
      </div>

      <label
        htmlFor={`page-type-${entry.specEntryId}`}
        className="mt-5 flex flex-col gap-1.5 text-sm font-medium text-ink"
      >
        页型
        <Input
          id={`page-type-${entry.specEntryId}`}
          value={entry.pageType}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              pageType: event.target.value,
            }))
          }
          placeholder="例如：cover、architecture、timeline"
          disabled={disabled}
        />
      </label>

      <div className="mt-5 border-t border-hairline pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">页面文字</h3>
            <p className="mt-1 text-xs leading-relaxed text-state-stale">
              这些文字同时是该页 OCR 复核的比对基准，重生成后会一并更新。
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange((current) => ({
                ...current,
                textGroups: [...current.textGroups, { label: "", items: [""] }],
              }))
            }
            disabled={disabled}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            添加分组
          </Button>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {entry.textGroups.map((group, groupIndex) => (
            <Panel
              // textGroups 契约没有持久 ID；控件均为受控输入，索引变化不会保留局部状态。
              // biome-ignore lint/suspicious/noArrayIndexKey: 不为渲染凭空扩充持久契约
              key={`${entry.specEntryId}-group-${groupIndex}`}
              elevation="sunken"
              className="p-3"
            >
              <div className="flex items-center gap-2">
                <Input
                  value={group.label}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      textGroups: current.textGroups.map((candidate, index) =>
                        index === groupIndex
                          ? { ...candidate, label: event.target.value }
                          : candidate,
                      ),
                    }))
                  }
                  placeholder="分组名称，例如：标题、流程阶段"
                  aria-label={`第 ${groupIndex + 1} 组名称`}
                  disabled={disabled}
                />
                <IconButton
                  label="删除文字分组"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      textGroups: current.textGroups.filter(
                        (_, index) => index !== groupIndex,
                      ),
                    }))
                  }
                  disabled={disabled}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </IconButton>
              </div>

              <div className="mt-2 flex flex-col gap-2">
                {group.items.map((item, itemIndex) => (
                  <div
                    // items 是纯字符串且无 ID；受控输入删除后直接由规格数组重绘。
                    // biome-ignore lint/suspicious/noArrayIndexKey: 不为渲染凭空扩充持久契约
                    key={`${entry.specEntryId}-${groupIndex}-item-${itemIndex}`}
                    className="flex items-center gap-2"
                  >
                    <Input
                      value={item}
                      onChange={(event) =>
                        onChange((current) => ({
                          ...current,
                          textGroups: current.textGroups.map(
                            (candidate, index) =>
                              index === groupIndex
                                ? {
                                    ...candidate,
                                    items: candidate.items.map(
                                      (candidateItem, candidateIndex) =>
                                        candidateIndex === itemIndex
                                          ? event.target.value
                                          : candidateItem,
                                    ),
                                  }
                                : candidate,
                          ),
                        }))
                      }
                      placeholder="页面上真实出现的一条文字"
                      aria-label={`第 ${groupIndex + 1} 组第 ${itemIndex + 1} 条文字`}
                      disabled={disabled}
                    />
                    <IconButton
                      label="删除这条文字"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        onChange((current) => ({
                          ...current,
                          textGroups: current.textGroups.map(
                            (candidate, index) =>
                              index === groupIndex
                                ? {
                                    ...candidate,
                                    items: candidate.items.filter(
                                      (_, index) => index !== itemIndex,
                                    ),
                                  }
                                : candidate,
                          ),
                        }))
                      }
                      disabled={disabled}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </IconButton>
                  </div>
                ))}
                <Button
                  className="self-start"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      textGroups: current.textGroups.map((candidate, index) =>
                        index === groupIndex
                          ? { ...candidate, items: [...candidate.items, ""] }
                          : candidate,
                      ),
                    }))
                  }
                  disabled={disabled}
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  添加文字
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      </div>

      <label
        htmlFor={`visual-intent-${entry.specEntryId}`}
        className="mt-5 flex flex-col gap-1.5 text-sm font-medium text-ink"
      >
        视觉意图
        <Textarea
          id={`visual-intent-${entry.specEntryId}`}
          className="min-h-24 resize-y"
          value={entry.visualIntent}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              visualIntent: event.target.value,
            }))
          }
          placeholder="描述版式、画面结构和视觉重点；这里的文字不会进入 OCR 基准"
          disabled={disabled}
        />
      </label>

      <div className="mt-5 border-t border-hairline pt-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-ink">调整说明</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange((current) => ({
                ...current,
                revisionNotes: [...current.revisionNotes, ""],
              }))
            }
            disabled={disabled}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            添加说明
          </Button>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {entry.revisionNotes.map((note, noteIndex) => (
            <div
              // revisionNotes 契约是字符串数组且无 ID；这里没有非受控局部状态。
              // biome-ignore lint/suspicious/noArrayIndexKey: 不为渲染凭空扩充持久契约
              key={`${entry.specEntryId}-note-${noteIndex}`}
              className="flex items-center gap-2"
            >
              <Input
                value={note}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    revisionNotes: current.revisionNotes.map(
                      (candidate, index) =>
                        index === noteIndex ? event.target.value : candidate,
                    ),
                  }))
                }
                placeholder="例如：减少装饰元素，突出结论"
                aria-label={`第 ${noteIndex + 1} 条调整说明`}
                disabled={disabled}
              />
              <IconButton
                label="删除调整说明"
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    revisionNotes: current.revisionNotes.filter(
                      (_, index) => index !== noteIndex,
                    ),
                  }))
                }
                disabled={disabled}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/**
 * 建页完成提示。
 *
 * ## 三种结局各由谁渲染
 *
 * | 结局 | 渲染者 |
 * |---|---|
 * | 受理并跑完（`accepted: true`） | 本组件 |
 * | 被互斥挡下（`accepted: false`） | `SourceTaskBar` 的 `sourceTaskBlockedReason` 分支 |
 * | 抛异常 | `SourceTaskBar` 的 error 分支（`runSourceTask` 的 catch 写进 store） |
 *
 * 三者互斥且都有人画，不存在「点完什么都没发生」的缝（见静默失败诊断指南）。
 *
 * ## 它与控制台 `GenerateResultPanel` 的关系
 *
 * 两者读的**不是同一份数据**：那边读 store 的 `lastResult`（全局最近一次任务），
 * 这边读本页发起那次的本地结果。两块面板长在互斥的两个视图上，永远不会同屏。
 * 点「去控制台」过去后，控制台会用同一次任务的 store 结果再显示一遍——这是**刻意
 * 保留**的：那块面板带着「去确认」，把用户直接送进逐张确认源图的下一步，而这一步
 * 不该在策划页重复给（用户可能只是想接着改规格）。
 *
 * **不吞失败**，也**不替用户自己的操作编理由**：数字与措辞一律由
 * `summarizeCreatePages` 给出（它为什么不看 `result.skipped`，见那里的说明）。
 * 本组件只负责画，不做任何算术——上一版就是在这里就地读 `skipped`，把用户刚刚
 * 取消勾选的 3 条说成「此前已经建过页」。
 */
function CreatePagesResult({
  result,
  onDismiss,
  onGoConsole,
}: {
  readonly result: CreatePagesSummary | null;
  readonly onDismiss: () => void;
  readonly onGoConsole: () => void;
}): React.JSX.Element | null {
  if (result === null) return null;

  return (
    <div className="shrink-0 border-b border-hairline bg-surface px-6 py-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-sm tabular-nums text-ink">
          已建立 {result.created} 页
          {result.failed > 0 && (
            <span className="font-medium text-state-failed">
              ，失败 {result.failed} 条
            </span>
          )}
          。{result.notes.join("")}
        </span>
        <Button size="sm" variant="secondary" onClick={onGoConsole}>
          去控制台
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          知道了
        </Button>
      </div>
    </div>
  );
}

/** 勾选框的通用切换：不可变地增删一个 id */
function toggled(
  current: ReadonlySet<string>,
  id: string,
  checked: boolean,
): Set<string> {
  const next = new Set(current);
  if (checked) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * 「规格影响」面板：待建页 / 已过时 / 失联页面三档。
 *
 * 三类**任一非空**即渲染（判据在 `hasSpecImpact`）。待建页与已过时共用同一套栅格、
 * 勾选控件与标题层级：两档并排而视觉不一致，会让人以为它们是两种不同性质的东西。
 * 失联页面仍然只有文案没有动作——删页是破坏性操作，且正确处置往往是恢复规格条目。
 */
function SpecImpactPanel({
  pending,
  drifted,
  missing,
  selectedPages,
  selectedEntries,
  dirty,
  running,
  onTogglePage,
  onToggleAllPages,
  onToggleEntry,
  onToggleAllEntries,
  onCreatePages,
  onRegenerate,
}: {
  readonly pending: ReturnType<typeof pendingEntrySummaries>;
  readonly drifted: ReturnType<typeof classifyOutdatedPages>["drifted"];
  readonly missing: ReturnType<typeof classifyOutdatedPages>["missing"];
  readonly selectedPages: ReadonlySet<string>;
  readonly selectedEntries: ReadonlySet<string>;
  readonly dirty: boolean;
  readonly running: boolean;
  readonly onTogglePage: (pageLabel: string, checked: boolean) => void;
  readonly onToggleAllPages: (checked: boolean) => void;
  readonly onToggleEntry: (specEntryId: string, checked: boolean) => void;
  readonly onToggleAllEntries: (checked: boolean) => void;
  readonly onCreatePages: () => void;
  readonly onRegenerate: () => void;
}) {
  if (
    !hasSpecImpact({
      pending: pending.length,
      drifted: drifted.length,
      missing: missing.length,
    })
  ) {
    return (
      <Panel as="section" className="p-5">
        <h2 className="text-lg font-semibold text-ink">规格影响</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {specImpactEmptyCopy(dirty)}
        </p>
      </Panel>
    );
  }
  const selectedCount = drifted.filter((slide) =>
    selectedPages.has(slide.pageLabel),
  ).length;
  const selectedEntryCount = selectedPendingEntryIds(
    pending,
    selectedEntries,
  ).length;
  const createAction = resolveCreatePagesAction({
    selectedCount: selectedEntryCount,
    dirty,
    running,
  });

  return (
    <Panel as="section" className="p-5">
      <h2 className="text-lg font-semibold text-ink">规格影响</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        清单来自当前 Deck 的全量状态，不只包含上一次保存新增的过时页。
      </p>

      {pending.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-4 border-b border-hairline pb-2">
            <h3 className="text-sm font-semibold tabular-nums text-proof">
              待建页 {pending.length} 条
            </h3>
            <div className="flex items-center gap-3">
              <Checkbox
                label="全选"
                checked={selectedEntryCount === pending.length}
                onChange={(event) => onToggleAllEntries(event.target.checked)}
              />
              <Button
                className="tabular-nums"
                variant="secondary"
                size="sm"
                onClick={onCreatePages}
                disabled={createAction.disabled}
                title={createAction.title ?? undefined}
              >
                {createAction.label}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
            这些规格条目还没有对应页面。建页按次计费，建好后每页都需要你逐张确认源图。
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {pending.map((entry) => (
              <Checkbox
                key={entry.specEntryId}
                // 标题长度不可控，必须能换行；`items-start` 让勾选框对齐首行
                className="items-start break-words rounded-sm border border-hairline px-3 py-2"
                label={`${entry.pageType || "未填页型"} · ${entry.title}`}
                hint={`规格条目 ${entry.specEntryId}`}
                checked={selectedEntries.has(entry.specEntryId)}
                onChange={(event) =>
                  onToggleEntry(entry.specEntryId, event.target.checked)
                }
              />
            ))}
          </div>
        </div>
      )}

      {drifted.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-4 border-b border-hairline pb-2">
            <h3 className="text-sm font-semibold tabular-nums text-proof">
              已过时 {drifted.length} 页
            </h3>
            <div className="flex items-center gap-3">
              <Checkbox
                label="全选"
                checked={selectedCount === drifted.length}
                onChange={(event) => onToggleAllPages(event.target.checked)}
              />
              <Button
                className="tabular-nums"
                variant="secondary"
                size="sm"
                onClick={onRegenerate}
                disabled={selectedCount === 0 || dirty || running}
                // 与建页那档同源：措辞只差动作词，两处各写一份迟早只改一份
                title={
                  specActionBlockedReason({
                    dirty,
                    running,
                    verb: "重生成",
                  }) ?? undefined
                }
              >
                重生成所选 {selectedCount} 页
              </Button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {drifted.map((slide) => (
              <Checkbox
                key={slide.slideId}
                className="rounded-sm border border-hairline px-3 py-2"
                label={slide.pageLabel}
                checked={selectedPages.has(slide.pageLabel)}
                onChange={(event) =>
                  onTogglePage(slide.pageLabel, event.target.checked)
                }
              />
            ))}
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <div className="mt-5 border-t border-hairline pt-4">
          <h3 className="text-sm font-semibold text-state-stale">失联页面</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
            这些页面对应的规格条目已被删除，无法重生成。请返回控制台确认后删除页面，
            或在规格中恢复对应条目。
          </p>
          <p className="mt-2 text-sm text-ink">
            {missing.map((slide) => slide.pageLabel).join("、")}
          </p>
        </div>
      )}
    </Panel>
  );
}

function PlanningSidebar({
  view,
  onViewChange,
  history,
  saving,
  onRollback,
  messages,
  proposals,
  dimensions,
  materials,
  hasSavedSpec,
  scope,
  selectedEntry,
  composerText,
  guardReason,
  busy,
  pending,
  composerPrimary,
  onScopeChange,
  onComposerChange,
  onSubmit,
  onDraft,
  onImportMaterial,
  onRemoveMaterial,
}: {
  readonly view: "conversation" | "history";
  readonly onViewChange: (view: "conversation" | "history") => void;
  readonly history: readonly SpecChangeRecord[];
  readonly saving: boolean;
  readonly onRollback: (record: SpecChangeRecord) => void;
  readonly messages: readonly PlanningMessage[];
  readonly proposals: readonly PlanningProposalState[];
  readonly dimensions: PlanningDimensions | null;
  readonly materials: readonly PlanningMaterialEntry[];
  readonly hasSavedSpec: boolean;
  readonly scope: "entry" | "deck";
  readonly selectedEntry: ContentSpecEntry | null;
  readonly composerText: string;
  readonly guardReason: string | null;
  readonly busy: boolean;
  readonly pending: boolean;
  readonly composerPrimary: boolean;
  readonly onScopeChange: (scope: "entry" | "deck") => void;
  readonly onComposerChange: (text: string) => void;
  readonly onSubmit: () => void;
  readonly onDraft: () => void;
  readonly onImportMaterial: () => void;
  readonly onRemoveMaterial: (name: string) => void;
}) {
  return (
    <aside className="flex w-96 shrink-0 flex-col border-r border-hairline bg-surface">
      <div className="shrink-0 border-b border-hairline px-4 py-3">
        <SegmentedGroup label="左栏内容" className="w-full">
          <SegmentedItem
            className="flex-1"
            selected={view === "conversation"}
            onClick={() => onViewChange("conversation")}
          >
            <MessageSquare aria-hidden="true" className="size-3.5" />
            对话
          </SegmentedItem>
          <SegmentedItem
            className="flex-1"
            selected={view === "history"}
            onClick={() => onViewChange("history")}
          >
            <Clock3 aria-hidden="true" className="size-3.5" />
            历史
          </SegmentedItem>
        </SegmentedGroup>
      </div>

      {view === "history" ? (
        <HistoryPanel
          history={history}
          saving={saving}
          onRollback={onRollback}
        />
      ) : (
        <ConversationPanel
          messages={messages}
          proposals={proposals}
          dimensions={dimensions}
          materials={materials}
          hasSavedSpec={hasSavedSpec}
          scope={scope}
          selectedEntry={selectedEntry}
          composerText={composerText}
          guardReason={guardReason}
          busy={busy}
          pending={pending}
          composerPrimary={composerPrimary}
          onScopeChange={onScopeChange}
          onComposerChange={onComposerChange}
          onSubmit={onSubmit}
          onDraft={onDraft}
          onImportMaterial={onImportMaterial}
          onRemoveMaterial={onRemoveMaterial}
        />
      )}
    </aside>
  );
}

function ConversationPanel({
  messages,
  proposals,
  dimensions,
  materials,
  hasSavedSpec,
  scope,
  selectedEntry,
  composerText,
  guardReason,
  busy,
  pending,
  composerPrimary,
  onScopeChange,
  onComposerChange,
  onSubmit,
  onDraft,
  onImportMaterial,
  onRemoveMaterial,
}: {
  readonly messages: readonly PlanningMessage[];
  readonly proposals: readonly PlanningProposalState[];
  readonly dimensions: PlanningDimensions | null;
  readonly materials: readonly PlanningMaterialEntry[];
  readonly hasSavedSpec: boolean;
  readonly scope: "entry" | "deck";
  readonly selectedEntry: ContentSpecEntry | null;
  readonly composerText: string;
  readonly guardReason: string | null;
  readonly busy: boolean;
  readonly pending: boolean;
  readonly composerPrimary: boolean;
  readonly onScopeChange: (scope: "entry" | "deck") => void;
  readonly onComposerChange: (text: string) => void;
  readonly onSubmit: () => void;
  readonly onDraft: () => void;
  readonly onImportMaterial: () => void;
  readonly onRemoveMaterial: (name: string) => void;
}) {
  const dimensionViews = buildDimensionViews(dimensions);
  const resolvedCount = dimensionViews.filter(
    (dimension) => dimension.status !== "open",
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section aria-labelledby="planning-progress-title">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="planning-progress-title"
              className="text-sm font-semibold text-ink"
            >
              策划收敛
            </h2>
            <span className="text-2xs tabular-nums text-ink-muted">
              {resolvedCount}/5
            </span>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1">
            {dimensionViews.map((dimension) => (
              <div
                key={dimension.key}
                className={
                  dimension.status === "open"
                    ? "rounded-sm border border-proof bg-proof-wash px-1 py-1.5 text-center"
                    : "rounded-sm border border-hairline bg-canvas px-1 py-1.5 text-center"
                }
                title={`${dimension.label}：${dimension.statusLabel}`}
              >
                <span className="block truncate text-2xs font-semibold text-ink">
                  {dimension.label}
                </span>
                <span
                  className={
                    dimension.status === "open"
                      ? "mt-0.5 block truncate text-2xs text-proof"
                      : "mt-0.5 block truncate text-2xs text-ink-muted"
                  }
                >
                  {dimension.statusLabel}
                </span>
              </div>
            ))}
          </div>
          {!hasSavedSpec && (
            <Button
              className="mt-3 w-full"
              variant="secondary"
              size="sm"
              onClick={onDraft}
              disabled={busy || pending}
              loading={busy}
            >
              就按现有信息出初稿
            </Button>
          )}
        </section>

        <section className="mt-5 border-t border-hairline pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText
                aria-hidden="true"
                className="size-3.5 text-ink-muted"
              />
              <h2 className="text-sm font-semibold text-ink">背景材料</h2>
              {materials.length > 0 && (
                <span className="text-2xs tabular-nums text-ink-muted">
                  {materials.length}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onImportMaterial}
              disabled={busy}
            >
              <Paperclip aria-hidden="true" className="size-3.5" />
              导入
            </Button>
          </div>
          {materials.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              可导入 .md / .txt；副本会持续参与这个 Deck 的每轮策划。
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {materials.map((material) => (
                <li
                  key={material.name}
                  className="flex items-center gap-2 rounded-sm bg-canvas px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">
                    {material.name}
                  </span>
                  <span className="shrink-0 text-2xs tabular-nums text-ink-muted">
                    {formatBytes(material.sizeBytes)}
                  </span>
                  <IconButton
                    label={`移除材料 ${material.name}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemoveMaterial(material.name)}
                    disabled={busy}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-5 border-t border-hairline pt-4">
          <h2 className="text-sm font-semibold text-ink">消息</h2>
          {messages.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {hasSavedSpec
                ? "描述想改的内容；模型只会提出可审阅的规格提案。"
                : "先说清楚主题与目标，助手会继续追问并收敛五个维度。"}
            </p>
          ) : (
            <ol className="mt-3 flex flex-col gap-2">
              {messages.map((message) => {
                const proposalStatus = resolveProposalMessageStatus(
                  proposals,
                  message.messageId,
                );
                return (
                  <li
                    key={message.messageId}
                    className={
                      message.role === "user"
                        ? "ml-5 rounded-md bg-surface-sunken px-3 py-2.5"
                        : "mr-5 rounded-md border border-hairline bg-canvas px-3 py-2.5"
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-2xs font-semibold text-ink-muted">
                        {message.role === "user" ? "你" : "策划助手"}
                      </span>
                      <time className="text-2xs tabular-nums text-ink-muted">
                        {formatMessageTime(message.at)}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {message.text}
                    </p>
                    {proposalStatus !== null && (
                      <p
                        className={
                          proposalStatus.pending
                            ? "mt-2 text-xs font-medium text-proof"
                            : "mt-2 text-xs text-ink-muted"
                        }
                      >
                        {proposalStatus.label}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-hairline bg-canvas px-4 py-4">
        {hasSavedSpec && (
          <div className="mb-3">
            <SegmentedGroup label="改稿作用域" className="w-full">
              <SegmentedItem
                className="flex-1"
                selected={scope === "entry"}
                onClick={() => onScopeChange("entry")}
                disabled={pending || busy || selectedEntry === null}
              >
                单条目
              </SegmentedItem>
              <SegmentedItem
                className="flex-1"
                selected={scope === "deck"}
                onClick={() => onScopeChange("deck")}
                disabled={pending || busy}
              >
                全 Deck
              </SegmentedItem>
            </SegmentedGroup>
            {scope === "entry" && (
              <p className="mt-2 truncate text-xs text-ink-muted">
                当前目标：
                <span className="font-medium text-ink-secondary">
                  {selectedEntry?.pageType ||
                    selectedEntry?.specEntryId ||
                    "无可用条目"}
                </span>
              </p>
            )}
          </div>
        )}
        <Textarea
          className="min-h-24 resize-y"
          value={composerText}
          onChange={(event) => onComposerChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={
            pending
              ? "先处理右侧提案"
              : hasSavedSpec
                ? "例如：把当前页压缩成三个结论"
                : "例如：做一份面向产品团队的季度复盘"
          }
          aria-label="策划消息"
          disabled={pending || busy || guardReason !== null}
        />
        {guardReason !== null && (
          <p className="mt-2 text-xs leading-relaxed text-proof">
            {guardReason}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-2xs text-ink-muted">⌘/Ctrl + Enter 发送</span>
          <Button
            variant={composerPrimary ? "primary" : "secondary"}
            onClick={onSubmit}
            disabled={
              composerText.trim() === "" ||
              guardReason !== null ||
              pending ||
              (hasSavedSpec && scope === "entry" && selectedEntry === null)
            }
            loading={busy}
          >
            <Send aria-hidden="true" className="size-3.5" />
            {hasSavedSpec ? "生成改稿提案" : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProposalReview({
  before,
  proposal,
  preview,
  selection,
  busy,
  onSelectionChange,
  onAccept,
  onReject,
}: {
  readonly before: ContentSpec | null;
  readonly proposal: StoredPlanningProposal;
  readonly preview: PlanningProposalPreview | null;
  readonly selection: PlanningProposalSelection;
  readonly busy: boolean;
  readonly onSelectionChange: (selection: PlanningProposalSelection) => void;
  readonly onAccept: () => void;
  readonly onReject: () => void;
}) {
  const sections = buildProposalDiffSections(
    before,
    proposal.candidate,
    selection,
  );
  const selectable = proposal.scope === "deck";
  const canAccept =
    preview !== null &&
    (selection.includeStyle || selection.specEntryIds.length > 0);

  function toggleSection(sectionId: string, checked: boolean): void {
    if (!selectable) return;
    if (sectionId === "style") {
      onSelectionChange({ ...selection, includeStyle: checked });
      return;
    }
    const ids = new Set(selection.specEntryIds);
    if (checked) ids.add(sectionId);
    else ids.delete(sectionId);
    onSelectionChange({ ...selection, specEntryIds: [...ids] });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-6 border-b border-hairline pb-4">
        <div>
          <p className="text-2xs font-semibold tracking-wide text-proof">
            待确认提案
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">
            {proposal.kind === "initial-draft" ? "规格初稿" : "规格改稿"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">
            逐字段核对 before /
            after。只有变化字段使用校对红；接受之前不会写入权威规格。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" onClick={onReject} disabled={busy}>
            拒绝提案
          </Button>
          <Button
            variant="primary"
            onClick={onAccept}
            disabled={!canAccept}
            loading={busy}
          >
            <Check aria-hidden="true" className="size-3.5" />
            接受提案
          </Button>
        </div>
      </div>

      {preview === null ? (
        <p className="text-sm text-ink-muted">正在计算提案影响…</p>
      ) : (
        <Panel className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm text-ink-secondary">确认后的新增影响</span>
          <span className="text-sm font-semibold tabular-nums text-proof">
            {preview.willDrift.length} 页已过时 · {preview.willMiss.length}{" "}
            页失联
          </span>
        </Panel>
      )}

      {sections.length === 0 ? (
        <Panel className="p-5 text-sm text-ink-muted">
          这份提案与当前规格没有字段差异，请拒绝后继续说明修改目标。
        </Panel>
      ) : (
        sections.map((section) => (
          <Panel
            key={section.id}
            as="section"
            className={section.selected ? "p-5" : "p-5 opacity-60"}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {section.label}
                </p>
                <p className="mt-0.5 text-2xs text-ink-muted">
                  {section.fields.filter((field) => field.changed).length}{" "}
                  个字段变化
                </p>
              </div>
              {selectable && (
                <Checkbox
                  label="纳入本次接受"
                  checked={section.selected}
                  onChange={(event) =>
                    toggleSection(section.id, event.target.checked)
                  }
                  disabled={busy}
                />
              )}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {section.fields.map((field) => (
                <div key={field.field}>
                  <p
                    className={
                      field.changed
                        ? "text-xs font-semibold text-proof"
                        : "text-xs font-semibold text-ink-muted"
                    }
                  >
                    {field.label}
                    {!field.changed && " · 未变化"}
                  </p>
                  <div className="mt-1.5 grid grid-cols-2 gap-3">
                    <DiffValue
                      label="Before"
                      value={field.before}
                      changed={field.changed}
                      side="before"
                    />
                    <DiffValue
                      label="After"
                      value={field.after}
                      changed={field.changed}
                      side="after"
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}

function ProposalDecisionWriteFailure(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Panel className="border-state-stale p-5">
        <p className="text-2xs font-semibold tracking-wide text-state-stale">
          规格已保存 · 会话留痕未完成
        </p>
        <h2 className="mt-1 text-xl font-semibold text-ink">
          不要再次接受这份提案
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
          规格写入已经成功，但 accepted 决策未能追加到 planning/session.jsonl。
          为避免重复写入，当前窗口不再提供接受或拒绝入口；请保留这条警告并检查会话文件写入问题。
        </p>
      </Panel>
    </div>
  );
}

function DiffValue({
  label,
  value,
  changed,
  side,
}: {
  readonly label: string;
  readonly value: string;
  readonly changed: boolean;
  readonly side: "before" | "after";
}) {
  return (
    <div
      className={
        changed && side === "after"
          ? "rounded-sm border border-proof bg-proof-wash px-3 py-2.5"
          : "rounded-sm border border-hairline bg-surface px-3 py-2.5"
      }
    >
      <p className="text-2xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
        {value || "（空）"}
      </p>
    </div>
  );
}

function HistoryPanel({
  history,
  saving,
  onRollback,
}: {
  readonly history: readonly SpecChangeRecord[];
  readonly saving: boolean;
  readonly onRollback: (record: SpecChangeRecord) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
      <div className="mb-4 flex items-center gap-2">
        <Clock3 aria-hidden="true" className="size-4 text-ink-muted" />
        <h2 className="text-sm font-semibold text-ink">变更历史</h2>
      </div>
      <div className="flex flex-col gap-2">
        {history.length === 0 ? (
          <p className="rounded-md border border-hairline bg-canvas px-3 py-3 text-xs leading-relaxed text-ink-muted">
            尚无变更历史。首次保存规格后，记录会按时间倒序显示在这里。
          </p>
        ) : (
          history.map((record) => (
            <HistoryRecord
              key={record.recordId}
              record={record}
              saving={saving}
              onRollback={() => onRollback(record)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function HistoryRecord({
  record,
  saving,
  onRollback,
}: {
  readonly record: SpecChangeRecord;
  readonly saving: boolean;
  readonly onRollback: () => void;
}) {
  const empty = isEmptyChangeRecord(record);
  const affected = new Set([
    ...record.entriesBefore.map((entry) => entry.specEntryId),
    ...record.entriesAfter.map((entry) => entry.specEntryId),
  ]).size;

  return (
    <details
      className={
        empty
          ? "group rounded-md border border-hairline bg-canvas/60 text-ink-muted"
          : "group rounded-md border border-hairline bg-canvas text-ink"
      }
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-3">
        <ChevronRight
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 transition-transform duration-fast group-open:rotate-90"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug">
            {record.summary}
          </span>
          <span className="mt-1 block text-2xs tabular-nums text-ink-muted">
            {formatHistoryTime(record.at)} · {originLabel(record.origin)} · 影响{" "}
            {affected} 条
          </span>
          {empty && <span className="mt-1 block text-2xs">无内容变更</span>}
        </span>
      </summary>
      <div className="border-t border-hairline px-3 py-3">
        {record.styleBefore.description !== record.styleAfter.description && (
          <HistoryField
            label="Deck 风格"
            before={record.styleBefore.description}
            after={record.styleAfter.description}
          />
        )}
        {record.entriesBefore.map((before, index) => {
          const after = record.entriesAfter[index];
          if (after === undefined) return null;
          return (
            <HistoryField
              key={before.specEntryId}
              label={before.specEntryId}
              before={formatHistoryEntry(before.value)}
              after={formatHistoryEntry(after.value)}
            />
          );
        })}
        {record.styleBefore.description === record.styleAfter.description &&
          record.entriesBefore.length === 0 && (
            <p className="text-xs text-ink-muted">这条记录没有规格字段变化。</p>
          )}
        <Button
          className="mt-3 w-full"
          variant="ghost"
          size="sm"
          onClick={onRollback}
          disabled={saving}
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          回滚到此记录之前
        </Button>
      </div>
    </details>
  );
}

function HistoryField({
  label,
  before,
  after,
}: {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}) {
  return (
    <div className="mb-3 text-xs leading-relaxed last:mb-0">
      <p className="font-semibold text-ink-secondary">{label}</p>
      <p className="mt-1 border-l-2 border-hairline pl-2 text-ink-muted">
        前：{before || "（空）"}
      </p>
      <p className="mt-1 border-l-2 border-proof pl-2 text-ink">
        后：{after || "（空）"}
      </p>
    </div>
  );
}

function newEntry(): ContentSpecEntry {
  return {
    specEntryId: `entry-${globalThis.crypto.randomUUID()}`,
    pageType: "",
    textGroups: [{ label: "", items: [""] }],
    visualIntent: "",
    revisionNotes: [],
  };
}

function originLabel(origin: SpecChangeRecord["origin"]): string {
  if (origin === "proposal") return "提案";
  if (origin === "rollback") return "回滚";
  return "手工编辑";
}

function formatHistoryTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatHistoryEntry(entry: ContentSpecEntry | null): string {
  if (entry === null) return "（不存在）";
  const texts = entry.textGroups
    .map((group) => `${group.label}：${group.items.join(" / ")}`)
    .join("；");
  const notes = entry.revisionNotes.join(" / ");
  return [
    `页型：${entry.pageType}`,
    texts === "" ? "" : `文字：${texts}`,
    entry.visualIntent === "" ? "" : `视觉：${entry.visualIntent}`,
    notes === "" ? "" : `调整：${notes}`,
  ]
    .filter(Boolean)
    .join("；");
}
