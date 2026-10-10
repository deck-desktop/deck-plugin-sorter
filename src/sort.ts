// The sorting DECISION, with no filesystem and no Deck.
//
// A separate file on purpose: it is pure, so node can import it directly (see sort.check.mjs)
// without a webview. Everything that used to be Rust judgement in sorter.rs lives here — which
// files to leave alone, and which category a file belongs to.

/** One category and the extensions that land in it. Extensions are lowercase, without the dot. */
export interface SortRule {
  category: string;
  extensions: string[];
}

export interface SortConfig {
  /** Target folder, an absolute path. "" means the user's Downloads. */
  dir: string;
  /** Whether the background sweep runs at all. */
  enabled: boolean;
  intervalMin: number;
  /** Move a file whose extension matches no rule into "Other". */
  unmatchedToOther: boolean;
  rules: SortRule[];
}

/** A directory entry, as fs_list reports it. `mtimeMs` is 0 when it could not be read. */
export interface Entry {
  name: string;
  dir: boolean;
  mtimeMs: number;
}

/** One file the sweep intends to move. */
export interface Move {
  name: string;
  category: string;
}

/** What actually moved, kept as a short log the UI shows. */
export interface MovedEntry {
  name: string;
  category: string;
  at: number;
}

// Never move: in-progress downloads and the Windows folder-view marker.
export const SKIP_EXT = ["crdownload", "part", "tmp", "download", "!ut"];
// Leave files touched in the last 2 minutes — likely still downloading.
export const MIN_AGE_MS = 120_000;

/** The extension, lowercased and without its dot. "" when the name has none. */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** The category a file belongs in, or null to leave it where it is. */
export function categoryFor(name: string, rules: SortRule[], unmatchedToOther: boolean): string | null {
  const ext = extOf(name);
  const hit = rules.find((r) => r.extensions.some((e) => e.toLowerCase() === ext));
  if (hit) return hit.category;
  // An extensionless file is not "unmatched", it is unclassifiable — moving it to Other on the
  // strength of having no extension is how a README or a LICENSE disappears into a folder.
  return unmatchedToOther && ext ? "Other" : null;
}

/**
 * What to move, given one directory listing.
 *
 * `now` is passed in rather than read so the age rule can be tested without waiting.
 */
export function plan(entries: Entry[], cfg: SortConfig, now: number): Move[] {
  const out: Move[] = [];
  for (const e of entries) {
    if (e.dir) continue; // leave subfolders — extracted apps, and our own category folders
    if (e.name.toLowerCase() === "desktop.ini") continue;
    if (SKIP_EXT.includes(extOf(e.name))) continue;
    // mtimeMs 0 means unreadable; treat it as settled rather than skipping forever.
    if (e.mtimeMs && now - e.mtimeMs < MIN_AGE_MS) continue;
    const category = categoryFor(e.name, cfg.rules, cfg.unmatchedToOther);
    if (category) out.push({ name: e.name, category });
  }
  return out;
}

export const DEFAULT_CONFIG: SortConfig = {
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
    { category: "Documents", extensions: ["pdf", "md", "txt", "csv", "html", "json"] },
  ],
};
