// plugins/sorter/src/mcp.ts
import { readdirSync, statSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// plugins/sorter/src/sort.ts
var SKIP_EXT = ["crdownload", "part", "tmp", "download", "!ut"];
var MIN_AGE_MS = 12e4;
function extOf(name) {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}
function categoryFor(name, rules, unmatchedToOther) {
  const ext = extOf(name);
  const hit = rules.find((r) => r.extensions.some((e) => e.toLowerCase() === ext));
  if (hit) return hit.category;
  return unmatchedToOther && ext ? "Other" : null;
}
function plan(entries, cfg, now) {
  const out = [];
  for (const e of entries) {
    if (e.dir) continue;
    if (e.name.toLowerCase() === "desktop.ini") continue;
    if (SKIP_EXT.includes(extOf(e.name))) continue;
    if (e.mtimeMs && now - e.mtimeMs < MIN_AGE_MS) continue;
    const category = categoryFor(e.name, cfg.rules, cfg.unmatchedToOther);
    if (category) out.push({ name: e.name, category });
  }
  return out;
}
var DEFAULT_CONFIG = {
  dir: "",
  enabled: false,
  intervalMin: 30,
  unmatchedToOther: true,
  rules: [
    { category: "Images", extensions: ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "heic", "heif"] },
    { category: "Videos", extensions: ["mp4", "mov"] },
    { category: "Audio", extensions: ["mp3", "wav", "m4a"] },
    { category: "Installers", extensions: ["exe", "msi", "msix"] },
    { category: "Archives", extensions: ["zip", "rar", "7z", "iso"] },
    { category: "Documents", extensions: ["pdf", "md", "txt", "csv", "html", "json"] }
  ]
};

// plugins/sorter/src/mcp.ts
var CFG_KEY = "plugin-sorter";
var LOG_KEY = "plugin-sorter-log";
var targetDir = (cfg) => cfg.dir.trim() || join(homedir(), "Downloads");
function listDir(dir) {
  return readdirSync(dir, { withFileTypes: true }).map((d) => {
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(join(dir, d.name)).mtimeMs;
    } catch {
    }
    return { name: d.name, dir: d.isDirectory(), mtimeMs };
  });
}
function register(server, deck) {
  const { z, ok, readJson, writeJson } = deck;
  const config = () => ({ ...DEFAULT_CONFIG, ...readJson(CFG_KEY, {}) });
  server.tool(
    "deck_sort_downloads",
    "Sort the downloads folder into category folders by file type, using the Sorter plugin's own rules. Files still downloading or touched in the last two minutes are left alone.",
    {
      dryRun: z.boolean().default(false).describe("list what would move without moving anything"),
      dir: z.string().optional().describe("override the folder to sort; defaults to the configured one")
    },
    async ({ dryRun, dir }) => {
      const cfg = config();
      const root = dir?.trim() || targetDir(cfg);
      if (!existsSync(root)) return ok(`Error: ${root} does not exist.`);
      const moves = plan(listDir(root), cfg, Date.now());
      if (!moves.length) return ok(`Nothing to sort in ${root}.`);
      const lines = moves.map((m) => `${m.name} -> ${m.category}`).join("\n");
      if (dryRun) return ok(`Would move ${moves.length} file(s) in ${root}:
${lines}`);
      const moved = [];
      const failed = [];
      for (const m of moves) {
        try {
          const destDir = join(root, m.category);
          mkdirSync(destDir, { recursive: true });
          renameSync(join(root, m.name), join(destDir, m.name));
          moved.push({ name: m.name, category: m.category, at: Date.now() });
        } catch {
          failed.push(m.name);
        }
      }
      if (moved.length) {
        const log = [...moved, ...readJson(LOG_KEY, [])].slice(0, 50);
        writeJson(LOG_KEY, log);
      }
      const tail = failed.length ? `
Skipped (in use): ${failed.join(", ")}` : "";
      return ok(`Moved ${moved.length} file(s) in ${root}:
${lines}${tail}`);
    }
  );
  server.tool(
    "deck_sort_rules",
    "Show the Sorter plugin's configuration: the folder it watches, whether the automatic sweep is on, and which extensions map to which category folder.",
    {},
    async () => {
      const cfg = config();
      const rules = cfg.rules.map((r) => `  ${r.category}: ${r.extensions.join(", ")}`).join("\n");
      return ok(
        `Folder: ${targetDir(cfg)}
Automatic sweep: ${cfg.enabled ? `on, every ${cfg.intervalMin} min` : "off"}
Unmatched files: ${cfg.unmatchedToOther ? "moved to Other" : "left alone"}
Rules:
${rules}`
      );
    }
  );
}
export {
  register
};
