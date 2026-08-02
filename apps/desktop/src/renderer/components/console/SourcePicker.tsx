import type { ContentSpec } from "@ppt-maker/core";
import { FileText, FolderOpen, Images, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  Panel,
  SECTION_LABEL,
  SegmentedGroup,
  SegmentedItem,
  Textarea,
} from "@/components/ui";
import {
  buildGenerateConfirm,
  generationCallCount,
  SOURCE_OPTION_LABELS,
  type SourceKindOption,
  type SpecPageSummary,
  summarizeSpec,
} from "@/lib/source-picker-core";
import { startSourceTask } from "@/lib/source-task";
import { cn } from "@/lib/utils";
import { createWorkspaceFromImages } from "@/lib/workspace-switch";
import {
  todayIso,
  workspacePathForFile,
  workspacePathForImages,
} from "@/lib/workspace-switch-core";
import type { SpecDraftResult } from "../../../main/ipc/channels.js";

/**
 * 来源选择 —— 三种页面来源的**唯一**入口（W2）。
 *
 * 一个组件、两个入口：新建 deck 与往已有 deck 追加共用同一份表单，差别只有目标
 * deck。父任务点名不得分三次零散增补，否则会长成三个并列按钮加三条各不相同的表单；
 * 而三种来源在 CLI 侧本就同构（deck 不存在则创建、存在则追加末尾），界面必须保住
 * 这条对称性，否则混合来源的 deck 在桌面端根本拼不出来。
 *
 * ## 这里不做的事
 *
 * - **不解析页码范围**：`3-8,12` 原样下传，解析器在 CLI 侧，写第二份就是同一个
 *   语法两套实现。非法输入由 CLI 报错，界面照常显示原因。
 * - **不编辑规格条目**：那是 M6「内容策划工作台」的核心。用户要改规格就改那个
 *   JSON 文件，改完由卡片上的漂移标注如实提示。
 * - **不连跑初稿与出图**：分页由模型给出且不具约束力，连跑等于把一次不可控的分页
 *   变成 N 次付费调用。初稿必须先让用户看见条目再决定。
 *
 * ## 主行动唯一
 *
 * 模态打开期间，全屏唯一的 primary 是这里的提交按钮 —— 底下控制台的「处理全部」
 * 被遮罩挡住且不可达。模态内部只有这一个 primary。
 */

interface SourcePickerProps {
  /** 追加的目标 deck 绝对路径；null 表示**新建**（空态入口） */
  readonly deckPath: string | null;
  readonly onClose: () => void;
}

/** 生成档的两条路（E1）：选已有规格文件，或从一段构思文本产初稿 */
type SpecMode = "file" | "draft";

export function SourcePicker({
  deckPath,
  onClose,
}: SourcePickerProps): React.JSX.Element {
  const createNew = deckPath === null;

  const [kind, setKind] = useState<SourceKindOption>("imported");
  const [imagesDir, setImagesDir] = useState<string | null>(null);
  const [imagePaths, setImagePaths] = useState<readonly string[]>([]);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pages, setPages] = useState("");
  const [specMode, setSpecMode] = useState<SpecMode>("file");
  const [specPath, setSpecPath] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [draft, setDraft] = useState<SpecDraftResult | null>(null);
  const [draftParentDir, setDraftParentDir] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLElement | null>(null);

  /*
   * Esc 关闭 + Tab 在对话框内循环。
   *
   * 焦点先落到面板本身，否则按键仍被背后的控制台接走。`aria-modal` 只是对读屏的
   * 声明，键盘焦点该由谁拦是代码的事——不拦的话 Tab 会走到被遮罩盖住的控制台上，
   * 用户看不见自己在哪。**这不构成键盘陷阱**：Esc 与「取消」都是随时可用的出口。
   */
  useEffect(() => {
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const root = panelRef.current;
      if (root === null) return;
      // 分段控件用 roving tabindex，未选中档位的 tabIndex 是 -1，不算停靠点
      const stops = [
        ...root.querySelectorAll<HTMLElement>(
          "button, input, textarea, select, [tabindex]",
        ),
      ].filter((node) => node.tabIndex >= 0 && !node.hasAttribute("disabled"));
      const first = stops[0];
      const last = stops.at(-1);
      if (first === undefined || last === undefined) return;

      const active = document.activeElement;
      // 面板自身（tabIndex -1，刚打开时的落点）算在「最前」这一侧：从它 ⇧Tab
      // 若不拦，焦点会退到遮罩背后去
      const atStart = active === first || active === root;
      const outside = !(active instanceof Node) || !root.contains(active);
      if (event.shiftKey ? atStart || outside : active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const draftPages: readonly SpecPageSummary[] = useMemo(
    () => (draft === null ? [] : summarizeSpec(draft.spec)),
    [draft],
  );

  /**
   * 新建时的落点：来源同级、目录名带日期后缀（与既有「从图片目录创建」同一条规则）。
   * 构思文本没有来源文件，因此那一条路额外要用户指定一个父目录。
   */
  const targetDeckPath = useMemo((): string | null => {
    if (!createNew) return deckPath;
    const iso = todayIso();
    switch (kind) {
      case "imported":
        return imagesDir === null
          ? null
          : workspacePathForImages(imagesDir, iso);
      case "extracted":
        return pdfPath === null ? null : workspacePathForFile(pdfPath, iso);
      case "generated":
        if (specMode === "file") {
          return specPath === null ? null : workspacePathForFile(specPath, iso);
        }
        return draftParentDir === null ? null : `${draftParentDir}/deck-${iso}`;
    }
  }, [
    createNew,
    deckPath,
    kind,
    imagesDir,
    pdfPath,
    specMode,
    specPath,
    draftParentDir,
  ]);

  /** 可提交与否，以及**不可提交的原因**——灰掉却不说为什么等同于没反应 */
  const blockedReason = useMemo((): string | null => {
    switch (kind) {
      case "imported":
        if (createNew) return imagesDir === null ? "请先选择图片目录" : null;
        return imagePaths.length === 0 ? "请先选择要追加的图片" : null;
      case "extracted":
        return pdfPath === null ? "请先选择 PDF 文件" : null;
      case "generated":
        if (specMode === "file") {
          return specPath === null ? "请先选择内容规格文件" : null;
        }
        if (draft === null) return "请先产出规格初稿，确认条目后再生成";
        if (createNew && draftParentDir === null) {
          return "请先选择新 Deck 的落点目录";
        }
        return null;
    }
  }, [
    kind,
    createNew,
    imagesDir,
    imagePaths,
    pdfPath,
    specMode,
    specPath,
    draft,
    draftParentDir,
  ]);

  async function handleDraft(): Promise<void> {
    if (idea.trim().length === 0) return;
    setBusy("draft");
    setError(null);
    try {
      setDraft(await window.api.deck.specDraft(idea));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  /**
   * 提交。长任务一旦发起就关掉模态：进度、结果与错误都归控制台上的建页任务条，
   * 让用户在等待期间还能看自己的 deck，而不是对着一个转圈的对话框。
   */
  async function handleSubmit(): Promise<void> {
    if (blockedReason !== null || targetDeckPath === null) return;

    /*
     * 付费门槛：批量生成在发起之前弹原生框，写明次数与不可撤销（E3）。
     *
     * 两条路都先把规格拿到手再问——初稿在内存里，已有文件经 `readContentSpec`
     * 读回（main 侧复用 CLI 的 `readContentSpecFile`，内含 schema 校验）。
     * 读不出来就**停在这里如实报错**，不退回一个不写数字的兜底文案：那样用户
     * 会以为门槛正常，实际上批准的是一次连读都没读明白的支出。
     */
    if (kind === "generated") {
      setBusy("submit");
      try {
        let spec: ContentSpec;
        if (specMode === "file") {
          if (specPath === null) return;
          spec = await window.api.deck.readContentSpec(specPath);
        } else {
          if (draft === null) return;
          spec = draft.spec;
        }

        // 条目数是**上限**：CLI 会与 deck 既有页对账跳过已生成的条目，
        // 而「新建」也可能落到同一天建过的同一个目录上（理由见 buildGenerateConfirm）
        const confirmed = await window.api.system.confirm(
          buildGenerateConfirm(generationCallCount(spec)),
        );
        if (!confirmed) return;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return;
      } finally {
        setBusy(null);
      }
    }

    const target = { deckPath: targetDeckPath, createNew };
    onClose();

    switch (kind) {
      case "imported":
        if (createNew) {
          // 新建的图片目录档沿用既有创建链路（它已含命名规则与切换后的状态清零），
          // 不为同一件事另造第二条路径
          if (imagesDir !== null) await createWorkspaceFromImages(imagesDir);
          return;
        }
        await startSourceTask(target, { kind: "import", imagePaths });
        return;
      case "extracted":
        if (pdfPath === null) return;
        await startSourceTask(target, {
          kind: "extract",
          pdfPath,
          // 留空即不传，让 CLI 走「全部页」的默认；空串会被当成一个非法范围
          ...(pages.trim() === "" ? {} : { pages: pages.trim() }),
        });
        return;
      case "generated": {
        const path = specMode === "file" ? specPath : (draft?.specPath ?? null);
        if (path === null) return;
        await startSourceTask(target, { kind: "generate", specPath: path });
        return;
      }
    }
  }

  return (
    /*
     * 遮罩用墨色低透明度，不用毛玻璃（DESIGN.md 明令禁止）。
     *
     * **点遮罩不关闭**：出口是 Esc 与「取消」两个明确动作。这里的表单可能已经填了
     * 一段构思文本、跑过一次初稿，一次落在边缘的误点就把它丢掉，代价远大于省下的
     * 一次点击；同时也省掉一个「静态元素上挂交互」的 a11y 抑制。
     */
    <div className="fixed inset-0 z-overlay flex items-start justify-center overflow-y-auto bg-ink/20 p-8">
      <Panel
        as="section"
        ref={panelRef}
        role="dialog"
        elevation="raised"
        aria-modal="true"
        aria-label={createNew ? "新建 Deck" : "添加页面"}
        tabIndex={-1}
        className="w-[36rem] max-w-full outline-none"
      >
        <header className="flex flex-col gap-1 border-b border-hairline px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">
            {createNew ? "新建 Deck" : "添加页面"}
          </h2>
          <p className="text-sm leading-relaxed text-ink-secondary">
            {createNew
              ? "选择页面的来源。三种来源可以混用，之后随时能用同一个入口往这个 Deck 里追加。"
              : "新页面一律追加到当前 Deck 末尾，已有页面不受影响。"}
          </p>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          <SegmentedGroup label="页面来源" className="self-start">
            {(["imported", "extracted", "generated"] as const).map((option) => (
              <SegmentedItem
                key={option}
                selected={kind === option}
                onClick={() => {
                  setKind(option);
                  setError(null);
                }}
              >
                {SOURCE_OPTION_LABELS[option]}
              </SegmentedItem>
            ))}
          </SegmentedGroup>

          {kind === "imported" && (
            <ImportedForm
              createNew={createNew}
              imagesDir={imagesDir}
              imagePaths={imagePaths}
              onPickDir={async () => {
                const dir = await window.api.system.selectDirectory();
                if (dir !== null) setImagesDir(dir);
              }}
              onPickFiles={async () => {
                const files = await window.api.system.selectFiles([
                  { name: "图片", extensions: ["png", "jpg", "jpeg"] },
                ]);
                if (files.length > 0) setImagePaths(files);
              }}
            />
          )}

          {kind === "extracted" && (
            <ExtractedForm
              pdfPath={pdfPath}
              pages={pages}
              onPages={setPages}
              onPickPdf={async () => {
                const file = await window.api.system.selectFile([
                  { name: "PDF 文档", extensions: ["pdf"] },
                ]);
                if (file !== null) setPdfPath(file);
              }}
            />
          )}

          {kind === "generated" && (
            <GeneratedForm
              createNew={createNew}
              specMode={specMode}
              onSpecMode={(next) => {
                setSpecMode(next);
                setError(null);
              }}
              specPath={specPath}
              idea={idea}
              onIdea={setIdea}
              draftPages={draftPages}
              drafting={busy === "draft"}
              draftParentDir={draftParentDir}
              onPickSpec={async () => {
                const file = await window.api.system.selectFile([
                  { name: "内容规格", extensions: ["json"] },
                ]);
                if (file !== null) setSpecPath(file);
              }}
              onPickParentDir={async () => {
                const dir = await window.api.system.selectDirectory();
                if (dir !== null) setDraftParentDir(dir);
              }}
              onDraft={() => void handleDraft()}
            />
          )}

          {createNew && targetDeckPath !== null && (
            <p
              className="truncate text-2xs text-ink-muted"
              title={targetDeckPath}
            >
              新 Deck 落点：{targetDeckPath}
            </p>
          )}

          {error !== null && (
            <p className="rounded-sm bg-state-failed/10 px-3 py-2 text-sm font-medium text-state-failed">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">
          {/* 禁用原因写出来，而不是只挂 title：禁用态不接受指针事件，title 根本弹不出来 */}
          {blockedReason !== null && (
            <p className="mr-auto text-sm text-ink-muted">{blockedReason}</p>
          )}
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            loading={busy === "submit"}
            disabled={blockedReason !== null}
            onClick={() => void handleSubmit()}
          >
            {createNew ? "创建 Deck" : "追加页面"}
          </Button>
        </footer>
      </Panel>
    </div>
  );
}

/** 已选路径的只读展示：长路径截断但可 hover 看全，不撑破对话框 */
function PickedPath({
  value,
  placeholder,
}: {
  value: string | null;
  placeholder: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm",
        value === null ? "text-ink-muted" : "text-ink",
      )}
      title={value ?? undefined}
    >
      {value ?? placeholder}
    </span>
  );
}

function FieldLabel({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return <p className={SECTION_LABEL}>{children}</p>;
}

function ImportedForm({
  createNew,
  imagesDir,
  imagePaths,
  onPickDir,
  onPickFiles,
}: {
  createNew: boolean;
  imagesDir: string | null;
  imagePaths: readonly string[];
  onPickDir: () => Promise<void>;
  onPickFiles: () => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>{createNew ? "图片目录" : "要追加的图片"}</FieldLabel>
      <div className="flex items-center gap-2">
        <PickedPath
          value={
            createNew
              ? imagesDir
              : imagePaths.length === 0
                ? null
                : `已选 ${imagePaths.length} 张`
          }
          placeholder={createNew ? "尚未选择目录" : "尚未选择图片"}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void (createNew ? onPickDir() : onPickFiles())}
        >
          <Images aria-hidden="true" className="size-3.5" />
          选择…
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-ink-muted">
        {createNew
          ? "目录里的 16:9 图片按文件名顺序入册，工作区建在该目录同级。"
          : "可一次选多张，按选择顺序追加到末尾。"}
      </p>
    </div>
  );
}

function ExtractedForm({
  pdfPath,
  pages,
  onPages,
  onPickPdf,
}: {
  pdfPath: string | null;
  pages: string;
  onPages: (next: string) => void;
  onPickPdf: () => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <FieldLabel>PDF 文件</FieldLabel>
        <div className="flex items-center gap-2">
          <PickedPath value={pdfPath} placeholder="尚未选择 PDF" />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void onPickPdf()}
          >
            <FileText aria-hidden="true" className="size-3.5" />
            选择…
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel>页码范围（可选）</FieldLabel>
        <Input
          value={pages}
          onChange={(event) => onPages(event.target.value)}
          placeholder="3-8,12 —— 留空则抽取全部页"
          aria-label="页码范围"
        />
        <p className="text-sm leading-relaxed text-ink-muted">
          非 16:9 的页会被跳过并列进抽取报告，命令不会整体失败。
        </p>
      </div>
    </div>
  );
}

function GeneratedForm({
  createNew,
  specMode,
  onSpecMode,
  specPath,
  idea,
  onIdea,
  draftPages,
  drafting,
  draftParentDir,
  onPickSpec,
  onPickParentDir,
  onDraft,
}: {
  createNew: boolean;
  specMode: SpecMode;
  onSpecMode: (next: SpecMode) => void;
  specPath: string | null;
  idea: string;
  onIdea: (next: string) => void;
  draftPages: readonly SpecPageSummary[];
  drafting: boolean;
  draftParentDir: string | null;
  onPickSpec: () => Promise<void>;
  onPickParentDir: () => Promise<void>;
  onDraft: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <SegmentedGroup label="规格来源" className="self-start">
        <SegmentedItem
          selected={specMode === "file"}
          onClick={() => onSpecMode("file")}
        >
          选已有规格文件
        </SegmentedItem>
        <SegmentedItem
          selected={specMode === "draft"}
          onClick={() => onSpecMode("draft")}
        >
          从构思文本产初稿
        </SegmentedItem>
      </SegmentedGroup>

      {specMode === "file" ? (
        <div className="flex items-center gap-2">
          <PickedPath
            value={specPath}
            placeholder="尚未选择 content-spec.json"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void onPickSpec()}
          >
            <FolderOpen aria-hidden="true" className="size-3.5" />
            选择…
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={5}
            value={idea}
            onChange={(event) => onIdea(event.target.value)}
            placeholder="粘一段构思：讲什么、分几个部分、每部分要出现哪些文字。"
            aria-label="构思文本"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={drafting}
              disabled={idea.trim().length === 0}
              onClick={onDraft}
            >
              <Sparkles aria-hidden="true" className="size-3.5" />
              产出初稿（将调用模型生成初稿）
            </Button>
            <p className="text-sm text-ink-muted">
              初稿不出图，不计图像生成费用。
            </p>
          </div>

          {draftPages.length > 0 && (
            <Panel
              elevation="sunken"
              className="flex max-h-56 flex-col gap-1 overflow-y-auto p-3"
            >
              <p className="text-sm font-medium tabular-nums text-ink">
                初稿共 {draftPages.length} 页 —— 确认后才会发起图像生成
              </p>
              <ol className="flex flex-col gap-0.5">
                {draftPages.map((page, index) => (
                  <li
                    key={page.specEntryId}
                    className="flex min-w-0 items-baseline gap-2 text-sm text-ink-secondary"
                  >
                    <span className="shrink-0 tabular-nums text-ink-muted">
                      {index + 1}
                    </span>
                    <span className="shrink-0 text-2xs text-ink-muted">
                      {page.pageType}
                    </span>
                    <span className="truncate" title={page.title}>
                      {page.title}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          {createNew && (
            <div className="flex items-center gap-2">
              <PickedPath
                value={draftParentDir}
                placeholder="尚未选择新 Deck 的落点目录"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void onPickParentDir()}
              >
                <FolderOpen aria-hidden="true" className="size-3.5" />
                选择落点…
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="text-sm leading-relaxed text-ink-muted">
        生成的页面都需要逐张确认源图；规格条目的编辑请直接改那个 JSON 文件。
      </p>
    </div>
  );
}

export type { SourcePickerProps };
