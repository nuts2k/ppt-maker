import type {
  ContentSpec,
  ContentSpecEntry,
  SpecChangeRecord,
} from "@ppt-maker/core";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Clock3,
  FolderOpen,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  Panel,
  Textarea,
} from "@/components/ui";
import {
  buildRegenerateBatchConfirm,
  classifyOutdatedPages,
  isEmptyChangeRecord,
} from "@/lib/planning-core";
import { startSourceTask } from "@/lib/source-task";
import { createEmptyPlanningWorkspace } from "@/lib/workspace-switch";
import { useDeckStore } from "@/stores/deck-store";
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

  const backToConsole = useUIStore((state) => state.backToConsole);
  const sourceTaskRunning = useSourceTaskStore((state) => state.running);
  const pipelineRunning = useRunStore((state) => state.status) !== "idle";
  const specWriteBlocked = sourceTaskRunning || pipelineRunning;
  const [summary, setSummary] = useState("");
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (
      deckPath !== null &&
      loadedDeckPath !== deckPath &&
      !(justCreated && loadedDeckPath === null)
    ) {
      void load(deckPath);
    }
  }, [deckPath, justCreated, load, loadedDeckPath]);

  const outdated = useMemo(() => classifyOutdatedPages(slides), [slides]);
  const driftedPageLabels = useMemo(
    () => outdated.drifted.map((slide) => slide.pageLabel),
    [outdated.drifted],
  );

  useEffect(() => {
    setSelectedPages(new Set(driftedPageLabels));
  }, [driftedPageLabels]);

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
    backToConsole();
  }

  async function handleSave(): Promise<void> {
    if (specWriteBlocked) return;
    const result = await save(summary);
    if (result === null) return;
    setSummary("");
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

  if (deckPath === null || (justCreated && loadedDeckPath === null)) {
    return <CreatePlanningDeck onBack={() => void handleBack()} />;
  }

  const editable = draft ?? saved;

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
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!dirty || editable === null || specWriteBlocked}
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

      {(error !== null || deckError !== null) && (
        <div className="shrink-0 border-b border-hairline bg-state-failed/10 px-6 py-3 text-sm font-medium text-state-failed">
          {error ?? deckError}
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

      <div className="flex min-h-0 flex-1">
        <HistoryPanel
          history={history}
          saving={saving || specWriteBlocked}
          onRollback={(record) => void handleRollback(record)}
        />

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
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
              />
              <OutdatedPages
                drifted={outdated.drifted}
                missing={outdated.missing}
                selected={selectedPages}
                dirty={dirty}
                running={sourceTaskRunning || pipelineRunning}
                onToggle={(pageLabel, checked) =>
                  setSelectedPages((current) => {
                    const next = new Set(current);
                    if (checked) next.add(pageLabel);
                    else next.delete(pageLabel);
                    return next;
                  })
                }
                onToggleAll={(checked) =>
                  setSelectedPages(
                    checked
                      ? new Set(
                          outdated.drifted.map((slide) => slide.pageLabel),
                        )
                      : new Set(),
                  )
                }
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
            先创建一个零页 Deck，再逐页填写风格、页面文字与视觉意图。
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
                创建并编辑规格
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
}: {
  readonly spec: ContentSpec;
  readonly onChange: (update: (spec: ContentSpec) => ContentSpec) => void;
  readonly disabled: boolean;
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
  onChange,
  onMove,
  onRemove,
}: {
  readonly entry: ContentSpecEntry;
  readonly index: number;
  readonly total: number;
  readonly disabled: boolean;
  readonly onChange: (
    update: (entry: ContentSpecEntry) => ContentSpecEntry,
  ) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  return (
    <Panel as="article" className="p-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold text-ink-muted">
            页面 {index + 1}
          </p>
          <p className="truncate text-xs text-ink-muted">{entry.specEntryId}</p>
        </div>
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

function OutdatedPages({
  drifted,
  missing,
  selected,
  dirty,
  running,
  onToggle,
  onToggleAll,
  onRegenerate,
}: {
  readonly drifted: ReturnType<typeof classifyOutdatedPages>["drifted"];
  readonly missing: ReturnType<typeof classifyOutdatedPages>["missing"];
  readonly selected: ReadonlySet<string>;
  readonly dirty: boolean;
  readonly running: boolean;
  readonly onToggle: (pageLabel: string, checked: boolean) => void;
  readonly onToggleAll: (checked: boolean) => void;
  readonly onRegenerate: () => void;
}) {
  if (drifted.length === 0 && missing.length === 0) {
    return (
      <Panel as="section" className="p-5">
        <h2 className="text-lg font-semibold text-ink">规格影响</h2>
        <p className="mt-2 text-sm text-ink-muted">
          当前没有已过时或失联页面；零页 Deck 也会保持这个空态。
        </p>
      </Panel>
    );
  }
  const selectedCount = drifted.filter((slide) =>
    selected.has(slide.pageLabel),
  ).length;

  return (
    <Panel as="section" className="p-5">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">规格影响</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            清单来自当前 Deck 的全量状态，不只包含上一次保存新增的过时页。
          </p>
        </div>
        {drifted.length > 0 && (
          <Button
            variant="secondary"
            onClick={onRegenerate}
            disabled={selectedCount === 0 || dirty || running}
            title={
              dirty
                ? "请先保存规格，再按磁盘现值重生成"
                : running
                  ? "已有建页任务正在执行"
                  : undefined
            }
          >
            重生成所选 {selectedCount} 页
          </Button>
        )}
      </div>

      {drifted.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between border-b border-hairline pb-2">
            <h3 className="text-sm font-semibold text-proof">已过时</h3>
            <Checkbox
              label="全选"
              checked={selectedCount === drifted.length}
              onChange={(event) => onToggleAll(event.target.checked)}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {drifted.map((slide) => (
              <Checkbox
                key={slide.slideId}
                className="rounded-sm border border-hairline px-3 py-2"
                label={slide.pageLabel}
                checked={selected.has(slide.pageLabel)}
                onChange={(event) =>
                  onToggle(slide.pageLabel, event.target.checked)
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
    <aside className="w-80 shrink-0 overflow-y-auto border-r border-hairline bg-surface px-4 py-5">
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
    </aside>
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
