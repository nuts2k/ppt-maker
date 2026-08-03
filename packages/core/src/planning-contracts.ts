import { z } from "zod";
import {
  type ContentSpec,
  type ContentSpecEntry,
  ContentSpecEntrySchema,
  type ContentSpecStyle,
  ContentSpecStyleSchema,
  specViewFingerprintValues,
} from "./content-spec-contracts.js";

/**
 * 内容策划工作台的**旁路数据**契约（M6 子任务①）。
 *
 * 这里定义的一切都落在 `<deck>/planning/` 下，与 `content-spec.json` 的关系是单向的：
 * 变更日志由规格写入路径捎带产生，规格的正确性**不依赖**它。整个 `planning/` 目录可删，
 * 删后只失去回看与回滚能力，`deck run` / `generate` / `status` / `export` 照常工作。
 *
 * 放在 core 而不是 CLI：桌面端渲染进程要 import `diffContentSpec` 做逐字段 diff 展示，
 * 而渲染进程引不到 `@cli/*`。**因此本文件不得出现任何 `node:` 开头的 import**——
 * 与 `content-spec-contracts.ts` 同一条纪律：哈希、文件系统、uuid 全留在 CLI 侧，
 * core 只放类型与纯函数。
 */

/**
 * 变更记录的**局部**版本号。
 *
 * 刻意**不用** `SCHEMA_VERSION`：那是全仓共用常量，manifest / stage-graph / workspace /
 * pptx / clean / content-spec 全把它写死成 `z.literal(SCHEMA_VERSION)`，升到 2 就是一次
 * 全仓迁移。旁路文件挂上去等于把自己绑进那次迁移——而它的内容一个字节都没变。
 *
 * 反过来，旁路数据也不需要全局版本轴：坏行跳过即可（见 `listSpecChangeRecords` 的读取
 * 纪律），丢一行历史不影响任何正确性判断。
 */
export const SPEC_CHANGE_RECORD_V = 1 as const;

/**
 * 这次规格变更是**谁**发起的。
 *
 * - `manual`：用户直接编辑规格（含 `deck generate --spec` 的首次导入、
 *   `deck regenerate` 追加调整说明）
 * - `proposal`：模型提案经用户确认后落盘（D5：模型可提案，不可直接落盘）
 * - `rollback`：回滚到某条历史记录之前的状态
 *
 * 首次导入不单独设一档：「首次写入」就是 before 为 null 的新增，`entriesBefore` 为空
 * 已经如实表达了它（子任务 C3）。
 */
export const SpecChangeOriginSchema = z.enum([
  "manual",
  "proposal",
  "rollback",
]);

export type SpecChangeOrigin = z.infer<typeof SpecChangeOriginSchema>;

/**
 * 一条受影响条目在**某一时刻**的样子。
 *
 * `value === null` 表示该时刻这个条目不存在：出现在 `entriesBefore` 即本次新增，
 * 出现在 `entriesAfter` 即本次删除。
 *
 * **必须带 `index`**：回滚要把条目插回原位，只有 id 和值恢复不出顺序。
 */
export interface AffectedEntry {
  readonly specEntryId: string;
  /** 变更时该条目在 `entries` 数组中的位置 */
  readonly index: number;
  /** `null` 表示该时刻不存在 */
  readonly value: ContentSpecEntry | null;
}

export const AffectedEntrySchema = z.object({
  specEntryId: z.string().min(1),
  index: z.number().int().min(0),
  value: ContentSpecEntrySchema.nullable(),
});

/** 受影响条目的新旧指纹，供「哪几页因此过时」的回看；条目不存在的一侧记 `null` */
export interface SpecChangeFingerprint {
  readonly specEntryId: string;
  readonly before: string | null;
  readonly after: string | null;
}

export const SpecChangeFingerprintSchema = z.object({
  specEntryId: z.string().min(1),
  before: z.string().nullable(),
  after: z.string().nullable(),
});

/**
 * `planning/spec-history.jsonl` 的一行。
 *
 * **只存受影响条目、但 style 每次前后全量**：style 改动波及全 deck（它进指纹投影），
 * 靠「受影响条目」表达不了；而它本身只有一段文本，全量存的代价可以忽略。
 *
 * `recordId` / `at` 由写入方分配，模型不得编造（D7 保护条 2）。
 */
export interface SpecChangeRecord {
  readonly v: 1;
  readonly recordId: string;
  readonly at: string;
  readonly origin: SpecChangeOrigin;
  /** 一句话人可读描述 */
  readonly summary: string;
  readonly styleBefore: ContentSpecStyle;
  readonly styleAfter: ContentSpecStyle;
  readonly entriesBefore: readonly AffectedEntry[];
  readonly entriesAfter: readonly AffectedEntry[];
  readonly fingerprints: readonly SpecChangeFingerprint[];
  /** `origin=proposal` 时指向 `session.jsonl` 的消息；否则 `null` */
  readonly conversationRef: string | null;
  /** `origin=rollback` 时指向被回滚的 `recordId`；否则 `null` */
  readonly rollbackOf: string | null;
}

export const SpecChangeRecordSchema = z.object({
  v: z.literal(SPEC_CHANGE_RECORD_V),
  recordId: z.string().min(1),
  at: z.string().datetime(),
  origin: SpecChangeOriginSchema,
  summary: z.string().min(1),
  styleBefore: ContentSpecStyleSchema,
  styleAfter: ContentSpecStyleSchema,
  entriesBefore: z.array(AffectedEntrySchema),
  entriesAfter: z.array(AffectedEntrySchema),
  fingerprints: z.array(SpecChangeFingerprintSchema),
  conversationRef: z.string().nullable(),
  rollbackOf: z.string().nullable(),
}) satisfies z.ZodType<SpecChangeRecord>;

/**
 * 两份规格之间的结构化差异——供界面逐字段 diff 展示，也供写入侧组装变更记录。
 *
 * `modified` 与 `reordered` 分开是**要害**：纯位置变化不改变条目指纹，因而不该让任何
 * 页面变为「已过时」。把它并进 `modified` 会让用户拖一下顺序就被告知 N 页要重出图。
 */
export interface ContentSpecDiff {
  readonly styleChanged: boolean;
  readonly entriesBefore: readonly AffectedEntry[];
  readonly entriesAfter: readonly AffectedEntry[];
  /** 以下三项均为 `specEntryId` */
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly string[];
  /** 存在「值未变但位置变了」的条目 */
  readonly reordered: boolean;
}

/**
 * 判断两个条目的内容是否相同——口径**复用指纹投影**，不另写一份字段列表。
 *
 * 这不是图省事：`modified` 的意义就是「这一页会因此过时」，而过时判据是
 * `specViewFingerprint` 比对。两处各写一份字段列表必然漂移，且漂移是静默的——
 * 界面说「没改」而页面被标成过时（或反之），没有任何东西会报错。
 *
 * 两侧喂同一个 style，投影首位的 `style:` 因此互相抵消，只比较条目自身。
 */
const ENTRY_EQUALITY_STYLE: ContentSpecStyle = { description: "" };

function entryEquals(left: ContentSpecEntry, right: ContentSpecEntry): boolean {
  const a = specViewFingerprintValues(ENTRY_EQUALITY_STYLE, left);
  const b = specViewFingerprintValues(ENTRY_EQUALITY_STYLE, right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function indexById(
  entries: readonly ContentSpecEntry[],
): Map<string, { readonly index: number; readonly entry: ContentSpecEntry }> {
  const map = new Map<
    string,
    { readonly index: number; readonly entry: ContentSpecEntry }
  >();
  entries.forEach((entry, index) => {
    map.set(entry.specEntryId, { index, entry });
  });
  return map;
}

/**
 * 以 `specEntryId` 为主键做左右外连接。
 *
 * 输出顺序是**确定的**：先按 after 的 index 升序，再把被删条目按 before 的 index 升序
 * 追加。确定性排序是回滚可重放的前提——同一份输入必须每次算出同一条记录。
 *
 * `entriesBefore` 与 `entriesAfter` 逐位配对，同一位置说的是同一个条目。
 */
export function diffContentSpec(
  before: ContentSpec,
  after: ContentSpec,
): ContentSpecDiff {
  const beforeById = indexById(before.entries);
  const afterById = indexById(after.entries);

  const entriesBefore: AffectedEntry[] = [];
  const entriesAfter: AffectedEntry[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  let reordered = false;

  after.entries.forEach((entry, index) => {
    const previous = beforeById.get(entry.specEntryId);
    if (previous === undefined) {
      added.push(entry.specEntryId);
      entriesBefore.push({
        specEntryId: entry.specEntryId,
        index,
        value: null,
      });
      entriesAfter.push({
        specEntryId: entry.specEntryId,
        index,
        value: entry,
      });
      return;
    }

    const changed = !entryEquals(previous.entry, entry);
    const moved = previous.index !== index;
    if (changed) {
      modified.push(entry.specEntryId);
    } else if (moved) {
      // 值没变、只是位置变了：不进 modified（指纹不变，页面不该因此过时），
      // 但必须进前后集合，否则回滚恢复不出原顺序。
      reordered = true;
    }
    if (!changed && !moved) {
      return;
    }
    entriesBefore.push({
      specEntryId: entry.specEntryId,
      index: previous.index,
      value: previous.entry,
    });
    entriesAfter.push({ specEntryId: entry.specEntryId, index, value: entry });
  });

  before.entries.forEach((entry, index) => {
    if (afterById.has(entry.specEntryId)) {
      return;
    }
    removed.push(entry.specEntryId);
    entriesBefore.push({ specEntryId: entry.specEntryId, index, value: entry });
    entriesAfter.push({ specEntryId: entry.specEntryId, index, value: null });
  });

  return {
    styleChanged: before.style.description !== after.style.description,
    entriesBefore,
    entriesAfter,
    added,
    removed,
    modified,
    reordered,
  };
}

/**
 * 把某条历史记录**之前**的状态重新写进当前规格——回滚的纯函数部分。
 *
 * 三步顺序固定，保证同一条记录任何时候重放都得到同一结果：
 *
 * 1. 删掉那次变更新增出来的条目（`entriesBefore` 里 `value === null` 的）；
 * 2. 对 `value !== null` 的项按 `index` **升序**处理：已存在同 id 则原地替换并移动到
 *    `index`，不存在则在 `index` 处插入（`index` 超出长度时追加）；
 * 3. 未被这条记录触及的条目**原样保留**。
 *
 * 第 3 步是「回滚是一次新的前进」的直接体现：只撤销那一次变更，不把它之后的无关变更
 * 一并抹掉。因此回滚本身也要经统一写入入口再记一条日志——历史只增不减。
 *
 * `specId` / `createdAt` 沿用 `current`（D7 保护条 2：id 与时间戳始终由代码分配）；
 * `updatedAt` 不在这里改，由写入入口统一盖。
 */
export function applyRollbackToSpec(
  current: ContentSpec,
  target: SpecChangeRecord,
): ContentSpec {
  const introduced = new Set(
    target.entriesBefore
      .filter((item) => item.value === null)
      .map((item) => item.specEntryId),
  );
  const entries = current.entries.filter(
    (entry) => !introduced.has(entry.specEntryId),
  );

  const restores = target.entriesBefore
    .filter(
      (item): item is AffectedEntry & { value: ContentSpecEntry } =>
        item.value !== null,
    )
    .slice()
    .sort((left, right) => left.index - right.index);

  for (const item of restores) {
    const existing = entries.findIndex(
      (entry) => entry.specEntryId === item.specEntryId,
    );
    if (existing >= 0) {
      entries.splice(existing, 1);
    }
    entries.splice(Math.min(item.index, entries.length), 0, item.value);
  }

  return { ...current, style: target.styleBefore, entries };
}
