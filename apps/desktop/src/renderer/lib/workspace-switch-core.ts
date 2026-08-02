/**
 * 切换工作区的编排规则（PRD R2 R3）。
 *
 * 依赖全部由参数注入、不碰任何 store，是为了能在 node 环境直接单测——
 * 本编排唯一的要害是**顺序**（先打开成功、再清零），而顺序写反的表现是
 * 「选错目录把好好的当前 deck 弄丢」，必须有回归保护。绑定真实 store 的
 * 薄壳见 `workspace-switch.ts`。
 */

/** 切换目标：打开已有工作区，或从图片目录新建一个再切过去 */
export type WorkspaceTarget =
  | { readonly kind: "open"; readonly path: string }
  | { readonly kind: "create"; readonly imagesDir: string };

export interface WorkspaceSwitchDeps {
  /** 打开目标 deck 并套用新状态；失败时抛出（错误由 deck-store 承载） */
  openDeck(path: string): Promise<void>;
  /** 创建工作区并套用新状态；失败时抛出 */
  createDeck(imagesDir: string, workspacePath: string): Promise<void>;
  /** 清零 deck-store 之外的其余 store（run / slide / activity / ui） */
  resetOtherStores(): void;
}

/**
 * 新工作区的落点：图片目录同级、目录名带日期后缀，避免重复创建时互相覆盖。
 * 命名规则原属 DeckEmptyState，抽出来是为了顶栏入口与空态入口不会分叉。
 */
export function workspacePathForImages(
  imagesDir: string,
  isoDate: string,
): string {
  const parentDir = imagesDir.split("/").slice(0, -1).join("/");
  const name = imagesDir.split("/").pop() ?? "deck";
  return `${parentDir}/${name}-${isoDate}`;
}

/**
 * 同一条落点规则用在**文件**来源上（PDF 抽取、内容规格生成的新建档）：
 * 落在该文件同级，目录名取去掉扩展名的文件名。
 *
 * 与 `workspacePathForImages` 分成两个函数而不是给它加一个开关：目录名里的点是
 * 名字的一部分（`~/decks/v1.2` 不该被截成 `v1`），文件名里的点是扩展名分隔符，
 * 两者不能用同一段代码去猜。首字符的点（`.hidden`）按名字处理，不当扩展名。
 */
export function workspacePathForFile(
  filePath: string,
  isoDate: string,
): string {
  const parentDir = filePath.split("/").slice(0, -1).join("/");
  const fileName = filePath.split("/").pop() ?? "deck";
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${parentDir}/${base}-${isoDate}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 执行一次切换：打开/创建成功后才清零其余 store。
 *
 * 顺序不可颠倒。deck-store 的 openDeck 失败时只写 `error`、不动 `deckPath` 与
 * `slides`，所以「失败停在当前 deck」正是靠清零发生在 await 之后——先清后开
 * 会在选错目录时掉进空态。失败一律原样抛出，由调用方决定如何呈现。
 *
 * 清零是同步的一段，中间不能插入 await：deckPath 变更会触发 ConsolePage 的
 * 活动日志重载 effect，若清零落到它之后就会把刚拉到的新 deck 日志抹掉。
 */
export async function applyWorkspaceSwitch(
  deps: WorkspaceSwitchDeps,
  target: WorkspaceTarget,
  isoDate: string = todayIso(),
): Promise<void> {
  switch (target.kind) {
    case "open":
      await deps.openDeck(target.path);
      break;
    case "create":
      await deps.createDeck(
        target.imagesDir,
        workspacePathForImages(target.imagesDir, isoDate),
      );
      break;
  }
  deps.resetOtherStores();
}
