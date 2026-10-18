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
import { ConfirmDialog, type ConfirmState } from "../shim/ui.js";
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
    <div className="group flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/5">
      <input
        value={rule.category}
        onChange={(e) => onChange({ category: e.target.value })}
        className="h-7 w-28 shrink-0 rounded-lg border border-subtle bg-elev px-2.5 text-[12.5px] font-medium text-text-primary outline-none transition-colors focus:border-[var(--accent)]"
      />
      <div className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-1">
        {rule.extensions.map((e) => (
          <span key={e} className="flex h-[22px] items-center gap-0.5 rounded-full pl-2 pr-0.5 font-mono text-[11px] text-text-secondary"
            style={{ background: "var(--bg-elev)" }}>
            .{e}
            <button onClick={() => removeExt(e)} title={`Remove .${e}`}
              className="grid size-4 place-items-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addExt(draft); } }}
          onBlur={() => addExt(draft)}
          placeholder="+ ext"
          className="w-16 bg-transparent px-1 py-0.5 font-mono text-[11px] text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>
      <button onClick={onRemove} title="Remove category"
        className="mt-1 grid size-5 shrink-0 place-items-center rounded text-text-muted opacity-0 transition hover:bg-white/10 hover:text-red-400 focus:opacity-100 group-hover:opacity-100">
        <X size={13} />
      </button>
    </div>
  );
}

export default function Sorter() {
  const [cfg, setCfg] = useState<SortConfig | null>(null);
  const [log, setLog] = useState<MovedEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");

  const loadLog = () => { void readLog().then(setLog).catch((e) => console.warn("[sorter] log load failed", e)); };
  useEffect(() => {
    void readConfig().then(setCfg).catch((e) => console.warn("[sorter] config load failed", e));
    loadLog();
  }, []);

  // Persisted on every change: editing rules is cheap and there is nothing to batch.
  const update = (patch: Partial<SortConfig>) => {
    setCfg((c) => {
      if (!c) return c;
      const next = { ...c, ...patch };
      writeConfig(next).catch((e) => console.warn("[sorter] config save failed", e));
      return next;
    });
  };

  const setRule = (i: number, patch: Partial<SortRule>) =>
    update({ rules: cfg!.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRule = () => update({ rules: [...cfg!.rules, { category: "New", extensions: [] }] });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const removeRule = (i: number) => setConfirm({
    title: `Remove ${cfg!.rules[i]?.category || "this category"}?`,
    body: "Its file types stop being sorted. Files already moved stay where they are.",
    confirmLabel: "Remove",
    onConfirm: () => update({ rules: cfg!.rules.filter((_, j) => j !== i) }),
  });

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
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12.5px] text-text-muted">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }

  const card = { background: "var(--bg-card-glass)" };
  const field = "rounded-lg border border-subtle bg-elev text-[12.5px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-[var(--accent)]";
  const heading = "text-[12px] font-medium text-text-secondary";
  const failed = flash.startsWith("Error");

  return (
    <div className="scroll-thin h-full w-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-1">

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text-primary">
              <FolderInput size={16} className="text-text-muted" /> Downloads sorter
            </h2>
            <p className="mt-0.5 text-[11.5px] text-text-muted">Move loose files into folders by extension.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {flash && <span className={"text-[11.5px] " + (failed ? "text-red-400" : "text-text-secondary")}>{flash}</span>}
            <button onClick={runNow} disabled={busy}
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-white transition hover:brightness-110 disabled:opacity-60"
              style={{ background: "var(--accent)" }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />} Sort now
            </button>
          </div>
        </div>

        <section className="rounded-lg border border-subtle p-3" style={card}>
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">Target folder</label>
          <div className="flex items-center gap-2">
            <input
              value={cfg.dir}
              onChange={(e) => update({ dir: e.target.value })}
              placeholder="Your Downloads folder (default)"
              className={field + " h-8 min-w-0 flex-1 px-2.5"}
            />
            <button onClick={pickDir} title="Browse"
              className="flex h-8 items-center gap-1.5 rounded-lg border border-subtle bg-elev px-3 text-[12px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary">
              <Folder size={13} /> Browse
            </button>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-subtle p-3" style={card}>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-text-primary">
            <input type="checkbox" checked={cfg.enabled}
              onChange={(e) => update({ enabled: e.target.checked })} className="accent-[var(--accent)]" />
            Auto-sort in background
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
            every
            <input type="number" min={1} value={cfg.intervalMin}
              onChange={(e) => update({ intervalMin: Math.max(1, Number(e.target.value) || 1) })}
              className={field + " h-7 w-16 px-2 text-center"}
            />
            min
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-text-secondary">
            <input type="checkbox" checked={cfg.unmatchedToOther}
              onChange={(e) => update({ unmatchedToOther: e.target.checked })} className="accent-[var(--accent)]" />
            Unmatched → “Other”
          </label>
        </section>

        <section className="flex flex-col gap-0.5">
          <div className="flex h-7 items-center justify-between px-1.5">
            <h3 className={heading}>Rules</h3>
            <button onClick={addRule}
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary">
              <Plus size={12} /> Add category
            </button>
          </div>
          {cfg.rules.map((r, i) => (
            <RuleRow key={i} rule={r} onChange={(p) => setRule(i, p)} onRemove={() => removeRule(i)} />
          ))}
          {cfg.rules.length === 0 && (
            <button onClick={addRule}
              className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary">
              <Plus size={12} /> No rules yet. Add a category and the extensions that go in it.
            </button>
          )}
        </section>

        {log.length > 0 && (
          <section className="flex flex-col gap-0.5">
            <div className="flex h-7 items-center gap-2 px-1.5">
              <Check size={13} className="text-green-400" />
              <span className={heading}>{logSummary(log)}</span>
            </div>
            <div className="scroll-thin max-h-52 overflow-y-auto">
              {log.map((e, i) => (
                <div key={i} className="flex h-6 items-center justify-between gap-3 rounded-md px-1.5 text-[12px] transition-colors hover:bg-white/5">
                  <span className="min-w-0 truncate text-text-secondary" title={e.name}>{e.name}</span>
                  <span className="flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10.5px] text-text-secondary"
                    style={{ background: "var(--bg-elev)" }}>{e.category}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
