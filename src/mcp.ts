// The agent-facing tools for the sorter.
//
// "Sort my downloads now" is the natural thing to ask an agent, and it is the one thing the
// sorter could not previously be asked to do — the sweep only ran on its own timer, inside
// Deck's webview.
//
// This file does the sort itself rather than asking Deck to, because there is nothing to ask:
// the sort lives in the plugin's TypeScript (`runSort` in io.ts), which needs a webview, and
// Deck's HTTP API has no "run a plugin command" route to reach it through. So the move happens
// here with node:fs, over the same `plan()` the UI uses — imported, not copied, so a rule change
// in sort.ts changes both.
//
// The two writers stay apart. Deck writes the log after ITS sweep, this writes it after THIS
// run, and each rewrites the whole array — so the worst a collision costs is one run missing
// from a 50-entry display list. Nothing here stamps a field Deck is the authority on.
import { readdirSync, statSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DeckMcp, McpServer } from "../shim/mcp.js";
import { plan, DEFAULT_CONFIG, type Entry, type MovedEntry, type SortConfig } from "./sort";

const CFG_KEY = "plugin-sorter";
const LOG_KEY = "plugin-sorter-log";

/** The folder to sort. Empty config means the user's Downloads, same as the UI. */
const targetDir = (cfg: SortConfig) => cfg.dir.trim() || join(homedir(), "Downloads");

/** One directory listing in the shape `plan` expects. Unreadable entries report mtime 0, which
 *  `plan` treats as settled — the same thing Deck's fs_list does. */
function listDir(dir: string): Entry[] {
  return readdirSync(dir, { withFileTypes: true }).map((d) => {
    let mtimeMs = 0;
    try { mtimeMs = statSync(join(dir, d.name)).mtimeMs; } catch { /* keep 0 */ }
    return { name: d.name, dir: d.isDirectory(), mtimeMs };
  });
}

export function register(server: McpServer, deck: DeckMcp) {
  const { z, ok, readJson, writeJson } = deck;

  const config = (): SortConfig => ({ ...DEFAULT_CONFIG, ...readJson<Partial<SortConfig>>(CFG_KEY, {}) });

  server.tool(
    "deck_sort_downloads",
    "Sort the downloads folder into category folders by file type, using the Sorter plugin's " +
      "own rules. Files still downloading or touched in the last two minutes are left alone.",
    {
      dryRun: z.boolean().default(false).describe("list what would move without moving anything"),
      dir: z.string().optional().describe("override the folder to sort; defaults to the configured one"),
    },
    async ({ dryRun, dir }) => {
      const cfg = config();
      const root = dir?.trim() || targetDir(cfg);
      if (!existsSync(root)) return ok(`Error: ${root} does not exist.`);

      const moves = plan(listDir(root), cfg, Date.now());
      if (!moves.length) return ok(`Nothing to sort in ${root}.`);
      const lines = moves.map((m) => `${m.name} -> ${m.category}`).join("\n");
      if (dryRun) return ok(`Would move ${moves.length} file(s) in ${root}:\n${lines}`);

      const moved: MovedEntry[] = [];
      const failed: string[] = [];
      for (const m of moves) {
        try {
          const destDir = join(root, m.category);
          mkdirSync(destDir, { recursive: true });
          // Overwrite rather than prompt: nobody is watching to answer, which is the same
          // choice the UI's "rename" collision mode makes for the same reason.
          renameSync(join(root, m.name), join(destDir, m.name));
          moved.push({ name: m.name, category: m.category, at: Date.now() });
        } catch {
          failed.push(m.name); // locked or in use — the next run retries it
        }
      }

      if (moved.length) {
        const log: MovedEntry[] = [...moved, ...readJson<MovedEntry[]>(LOG_KEY, [])].slice(0, 50);
        writeJson(LOG_KEY, log);
      }
      const tail = failed.length ? `\nSkipped (in use): ${failed.join(", ")}` : "";
      return ok(`Moved ${moved.length} file(s) in ${root}:\n${lines}${tail}`);
    },
  );

  server.tool(
    "deck_sort_rules",
    "Show the Sorter plugin's configuration: the folder it watches, whether the automatic " +
      "sweep is on, and which extensions map to which category folder.",
    {},
    async () => {
      const cfg = config();
      const rules = cfg.rules.map((r) => `  ${r.category}: ${r.extensions.join(", ")}`).join("\n");
      return ok(
        `Folder: ${targetDir(cfg)}\n` +
          `Automatic sweep: ${cfg.enabled ? `on, every ${cfg.intervalMin} min` : "off"}\n` +
          `Unmatched files: ${cfg.unmatchedToOther ? "moved to Other" : "left alone"}\n` +
          `Rules:\n${rules}`,
      );
    },
  );
}
