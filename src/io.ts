// Everything the sorter does to the disk, and the background sweep that drives it.
//
// Separate from sort.ts so the decision stays pure and testable, and separate from the component
// so the sweep can live at module scope — Deck unmounts a module the moment you navigate away,
// and auto-sort has to keep working while you are elsewhere.
import { configRead, configWrite, fsHomeDir, fsList, fsMove } from "../shim/bridge.js";
import { plan, DEFAULT_CONFIG, type Entry, type MovedEntry, type SortConfig } from "./sort";

// This plugin's own config, under the "plugin-" prefix config.rs keeps device-local — a Windows
// disk path and a list of this machine's filenames mean nothing on the phone, and syncing them
// would be a small privacy leak for no gain.
const CFG_KEY = "plugin-sorter";
const LOG_KEY = "plugin-sorter-log";

export async function readConfig(): Promise<SortConfig> {
  try {
    const t = await configRead(CFG_KEY);
    return t.trim() ? { ...DEFAULT_CONFIG, ...JSON.parse(t) } : DEFAULT_CONFIG;
  } catch { return DEFAULT_CONFIG; }
}

export const writeConfig = (cfg: SortConfig) => configWrite(CFG_KEY, JSON.stringify(cfg));

export async function readLog(): Promise<MovedEntry[]> {
  try {
    const t = await configRead(LOG_KEY);
    return t.trim() ? JSON.parse(t) : [];
  } catch { return []; }
}

/**
 * Sort once. Returns what moved.
 *
 * The whole feature, in the plugin: list the folder, decide with `plan`, move. It used to be
 * run_sort in sorter.rs. The only Rust left is generic — fs_list and fs_move, which know nothing
 * about sorting.
 */
export async function runSort(cfg: SortConfig): Promise<MovedEntry[]> {
  const dir = cfg.dir.trim() || `${await fsHomeDir()}/Downloads`;
  const entries = (await fsList(dir)) as Entry[];
  const moves = plan(entries, cfg, Date.now());
  const moved: MovedEntry[] = [];
  for (const m of moves) {
    try {
      // "rename" because nobody is watching to answer an overwrite prompt. fs_move creates the
      // category folder itself, so there is no mkdir round trip per category.
      await fsMove(`${dir}/${m.name}`, `${dir}/${m.category}`, "rename");
      moved.push({ name: m.name, category: m.category, at: Date.now() });
    } catch { /* locked or in use — skip; the next run retries */ }
  }
  if (moved.length) {
    const log = [...moved, ...(await readLog())].slice(0, 50);
    await configWrite(LOG_KEY, JSON.stringify(log));
  }
  return moved;
}

/**
 * The background sweep, replacing the spawn_sorter thread.
 *
 * Started from module scope, so it outlives the component the way core/ stores outlive theirs.
 *
 * ponytail: a hidden window throttles timers to about a minute, so a 30-minute cadence can drift
 * by that much. Irrelevant for sorting downloads; the upgrade if it ever matters is a Rust timer
 * that emits an event.
 */
export function startSweep(): () => void {
  let lastRun = 0;
  const id = setInterval(async () => {
    const cfg = await readConfig();
    if (!cfg.enabled) return;
    if (Date.now() - lastRun < Math.max(1, cfg.intervalMin) * 60_000) return;
    lastRun = Date.now();
    try { await runSort(cfg); } catch { /* a failed run must not stop later ones */ }
  }, 30_000);
  return () => clearInterval(id);
}
