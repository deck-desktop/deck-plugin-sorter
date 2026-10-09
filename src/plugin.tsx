// The Downloads Sorter. Deck ships no sorter module — this plugin is the whole feature: the
// extension rules, the skip list, the age check, the moving, and the background cadence.
//
// Deck contributes only generic file operations that know nothing about sorting: fs_list (which
// reports mtime, so a half-written download can be told from a settled file), fs_move (which
// deduplicates a colliding name and creates the destination), and config read/write.
//
// That is the difference between a plugin that renders a built-in feature and one that IS a
// feature. Someone else could write this without touching Deck's source.
import { useEffect, useState } from "react";
import { FolderInput, Play, Loader2, X, Plus, Folder, Check } from "lucide-react";
import { pickFolder } from "../shim/bridge.js";
import { type MovedEntry, type SortConfig, type SortRule } from "./sort";
import { readConfig, writeConfig, readLog, runSort, startSweep } from "./io";

// Started at module scope, not in the component: Deck unmounts a module when you navigate away,
// and auto-sort has to keep working while you are elsewhere.
/** Called by Deck before a reload re-imports this plugin, so the old copy's sweep stops. */
export const dispose = startSweep();

/** Group log entries into a short human line: "12 recent • Images, Videos". */
function logSummary(log: MovedEntry[]): string {
  if (!log.length) return "";
  const cats = [...new Set(log.map((e) => e.category))];
  return `${log.length} recent • ${cats.join(", ")}`;
}

/** One rule: category name plus editable extension chips. */
function RuleRow({ rule, onChange, onRemove }: {
  rule: SortRule;
  onChange: (patch: Partial<SortRule>) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState("");

  const addExt = (raw: string) => {
    const e = raw.trim().toLowerCase().replace(/^\./, "");
    if (e && !rule.extensions.includes(e)) onChange({ extensions: [...rule.extensions, e] });
    setDraft("");
  };
  const removeExt = (e: string) => onChange({ extensions: rule.extensions.filter((x) => x !== e) });

  return (
    <div className="flex items-start gap-3 rounded-xl border border-subtle p-3" style={{ background: "var(--bg-card-glass)" }}>
      <input
        value={rule.category}
        onChange={(e) => onChange({ category: e.target.value })}
        className="w-28 shrink-0 rounded-md border border-subtle bg-transparent px-2 py-1 text-sm font-medium text-text-primary outline-none focus:border-[var(--accent)]"
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {rule.extensions.map((e) => (
          <span key={e} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
            style={{ background: "var(--bg-elev)", color: "var(--text-secondary)" }}>
            .{e}
            <button onClick={() => removeExt(e)} className="text-text-muted hover:text-text-primary">
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addExt(draft); } }}
          onBlur={() => addExt(draft)}
          placeholder="+ ext"
          className="w-16 bg-transparent px-1 py-0.5 text-xs text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>
      <button onClick={onRemove} title="Remove category" className="shrink-0 text-text-muted hover:text-red-400">
        <X size={15} />
      </button>
    </div>
  );
}

export default function Sorter() {
  const [cfg, setCfg] = useState<SortConfig | null>(null);
  const [log, setLog] = useState<MovedEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");

  const loadLog = () => { void readLog().then(setLog).catch(() => {}); };
  useEffect(() => {
    void readConfig().then(setCfg).catch(() => {});
    loadLog();
  }, []);

  // Persisted on every change: editing rules is cheap and there is nothing to batch.
  const update = (patch: Partial<SortConfig>) => {
    setCfg((c) => {
      if (!c) return c;
      const next = { ...c, ...patch };
      writeConfig(next).catch(() => {});
      return next;
    });
  };

  const setRule = (i: number, patch: Partial<SortRule>) =>
    update({ rules: cfg!.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRule = () => update({ rules: [...cfg!.rules, { category: "New", extensions: [] }] });
  const removeRule = (i: number) => update({ rules: cfg!.rules.filter((_, j) => j !== i) });

  const runNow = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      const moved = await runSort(cfg);
      setFlash(moved.length ? `Sorted ${moved.length} file(s)` : "Nothing to sort");
      loadLog();
    } catch (e) {
      setFlash(`Error: ${e}`);
    } finally {
      setBusy(false);
      setTimeout(() => setFlash(""), 2500);
    }
  };

  const pickDir = async () => {
    const d = await pickFolder();
    if (d) update({ dir: d });
  };

  if (!cfg) {
    return <div className="flex h-full items-center justify-center text-sm text-text-muted">Loading…</div>;
  }

  const card = { background: "var(--bg-card-glass)" };

  return (
    <div className="scroll-thin h-full w-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-1">

        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-text-primary">
              <FolderInput size={19} style={{ color: "var(--accent)" }} /> Downloads Sorter
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">Move loose files into folders by extension.</p>
          </div>
          <div className="flex items-center gap-2">
            {flash && <span className="text-xs text-text-secondary">{flash}</span>}
            <button onClick={runNow} disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--accent)" }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Sort Now
            </button>
          </div>
        </div>

        <section className="rounded-xl border border-subtle p-4" style={card}>
          <label className="mb-2 block text-xs font-medium text-text-secondary">Target folder</label>
          <div className="flex items-center gap-2">
            <input
              value={cfg.dir}
              onChange={(e) => update({ dir: e.target.value })}
              placeholder="Your Downloads folder (default)"
              className="min-w-0 flex-1 rounded-lg border border-subtle bg-transparent px-3 py-2 text-sm text-text-primary outline-none focus:border-[var(--accent)]"
            />
            <button onClick={pickDir} title="Browse"
              className="flex items-center gap-1 rounded-lg border border-subtle px-3 py-2 text-sm text-text-secondary hover:text-text-primary">
              <Folder size={15} /> Browse
            </button>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-subtle p-4" style={card}>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" checked={cfg.enabled}
              onChange={(e) => update({ enabled: e.target.checked })} className="accent-[var(--accent)]" />
            Auto-sort in background
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            every
            <input type="number" min={1} value={cfg.intervalMin}
              onChange={(e) => update({ intervalMin: Math.max(1, Number(e.target.value) || 1) })}
              className="w-16 rounded-md border border-subtle bg-transparent px-2 py-1 text-center text-sm text-text-primary outline-none focus:border-[var(--accent)]"
            />
            min
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={cfg.unmatchedToOther}
              onChange={(e) => update({ unmatchedToOther: e.target.checked })} className="accent-[var(--accent)]" />
            Unmatched → “Other”
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Rules</h3>
            <button onClick={addRule} className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
              <Plus size={14} /> Add category
            </button>
          </div>
          {cfg.rules.map((r, i) => (
            <RuleRow key={i} rule={r} onChange={(p) => setRule(i, p)} onRemove={() => removeRule(i)} />
          ))}
        </section>

        {log.length > 0 && (
          <section className="rounded-xl border border-subtle p-4" style={card}>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-secondary">
              <Check size={13} style={{ color: "var(--accent)" }} /> {logSummary(log)}
            </div>
            <div className="scroll-thin max-h-52 space-y-1 overflow-y-auto">
              {log.map((e, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-text-secondary">{e.name}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5"
                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{e.category}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
