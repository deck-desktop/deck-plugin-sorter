// npx tsx sort.check.mjs
//
// The sort decision is the only part of this plugin worth a test: the IO around it is a listing
// and a move. These are the rules that used to live in sorter.rs, where a mistake silently moves
// or strands a file rather than failing loudly.
import assert from "node:assert";
// src/sort.ts holds the decision and touches neither the filesystem nor Deck, so it imports
// cleanly outside a webview — which is the reason it is a separate file. Run with tsx, since it
// is TypeScript now.
import { plan, categoryFor, extOf, DEFAULT_CONFIG, MIN_AGE_MS } from "./src/sort";

const NOW = 1_700_000_000_000;
const old = NOW - MIN_AGE_MS - 1; // comfortably settled
const cfg = DEFAULT_CONFIG;

assert.strictEqual(extOf("a.PNG"), "png");
assert.strictEqual(extOf("archive.tar.gz"), "gz");
assert.strictEqual(extOf("README"), "");      // no extension at all
assert.strictEqual(extOf(".gitignore"), "");  // a dotfile is not an extension

assert.strictEqual(categoryFor("photo.jpg", cfg.rules, true), "Images");
assert.strictEqual(categoryFor("clip.MOV", cfg.rules, true), "Videos"); // case-insensitive
assert.strictEqual(categoryFor("thing.xyz", cfg.rules, true), "Other");
assert.strictEqual(categoryFor("thing.xyz", cfg.rules, false), null);
// Extensionless files are unclassifiable, not unmatched — a README must not vanish into Other.
assert.strictEqual(categoryFor("README", cfg.rules, true), null);

const entries = [
  { name: "photo.jpg", dir: false, mtimeMs: old },
  { name: "Images", dir: true, mtimeMs: old },                 // our own category folder
  { name: "movie.mp4.crdownload", dir: false, mtimeMs: old },  // still downloading
  { name: "desktop.ini", dir: false, mtimeMs: old },           // Windows folder marker
  { name: "fresh.pdf", dir: false, mtimeMs: NOW - 1000 },      // touched a second ago
  { name: "notes.md", dir: false, mtimeMs: old },
];
const moves = plan(entries, cfg, NOW);
assert.deepStrictEqual(moves, [
  { name: "photo.jpg", category: "Images" },
  { name: "notes.md", category: "Documents" },
]);

// A file whose mtime could not be read is treated as settled — otherwise it would be skipped
// on every run forever, which is worse than moving it.
assert.deepStrictEqual(
  plan([{ name: "x.pdf", dir: false, mtimeMs: 0 }], cfg, NOW),
  [{ name: "x.pdf", category: "Documents" }],
);

// The age rule is a boundary: exactly MIN_AGE_MS old is settled.
assert.strictEqual(plan([{ name: "a.pdf", dir: false, mtimeMs: NOW - MIN_AGE_MS }], cfg, NOW).length, 1);
assert.strictEqual(plan([{ name: "a.pdf", dir: false, mtimeMs: NOW - MIN_AGE_MS + 1 }], cfg, NOW).length, 0);

console.log("ok");
