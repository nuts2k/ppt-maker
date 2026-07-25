import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { loadDeckWorkspace } from "@cli/deck/workspace.js";

export interface DeckContext {
  readonly deckPath: string;
  readonly deckId: string;
  readonly pageLabel: string;
}

const deckIdCache = new Map<string, string>();

/** 向上回溯的最大层数：slide 工作区位于 `<deck>/slides/page-NN`，即两层 */
const MAX_LOOKUP_DEPTH = 3;

export async function resolveDeckId(deckPath: string): Promise<string> {
  const path = resolve(deckPath);
  const cached = deckIdCache.get(path);
  if (cached !== undefined) return cached;
  const deck = await loadDeckWorkspace(path);
  deckIdCache.set(path, deck.manifest.deckId);
  return deck.manifest.deckId;
}

async function hasDeckManifest(path: string): Promise<boolean> {
  try {
    await stat(join(path, "deck-manifest.json"));
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 slide 工作区反查所属 deck，逐级向上寻找 deck-manifest.json。
 *
 * 反查失败时返回 null——调用方据此跳过日志记录，不影响主流程
 * （单页工作区可以脱离 deck 独立存在）。
 */
export async function resolveDeckContext(
  slideWorkspacePath: string,
): Promise<DeckContext | null> {
  const ws = resolve(slideWorkspacePath);
  let current = dirname(ws);

  for (let depth = 0; depth < MAX_LOOKUP_DEPTH; depth += 1) {
    if (await hasDeckManifest(current)) {
      try {
        return {
          deckPath: current,
          deckId: await resolveDeckId(current),
          pageLabel: basename(ws),
        };
      } catch {
        return null;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}
