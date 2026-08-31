import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, CornerDownLeft, ArrowUp, ArrowDown, Clock, Sparkles } from "lucide-react";
import { safeLocalStorage } from "../utils/safeStorage";

// =============================================================================
// CommandPalette.tsx — QA5-F2 (round 5)
// Global Ctrl+K / Cmd+K quick navigator for the ZAYTRIX shell.
//
// Design goals:
//   - 15-tab SPA = lots of navigation; the palette makes every tab reachable
//     in ≤4 keystrokes (Ctrl+K, 2 chars, Enter).
//   - Beyond navigation it hosts ACTIONS (theme switching, reload, logout) so
//     operators get a keyboard-first control surface.
//   - Zero dependencies: fuzzy matching, recents and keyboard nav are
//     hand-rolled (~180 lines) — no cmdk dependency added.
//
// Accessibility (mandatory for this codebase):
//   - role="dialog" + aria-modal, Esc closes, focus is trapped inside the
//     input, arrow keys move an aria-activedescendant-highlighted listbox.
//   - Every result is a real button (Enter/click equivalent).
// =============================================================================

export interface PaletteItem {
  id: string;
  name: string;
  group: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  keywords?: string;
  action: () => void;
}

const RECENTS_KEY = "command_palette_recents";
const MAX_RECENTS = 4;

// --- Fuzzy scoring: subsequence match with bonuses for consecutive runs and
// --- word-start matches. Returns null when the query doesn't match at all.
function fuzzyScore(name: string, query: string): { score: number; indices: number[] } | null {
  if (!query) return { score: 0, indices: [] };
  const target = name.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  let ti = 0;
  let run = 0;
  const indices: number[] = [];
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (ti < target.length) {
      if (target[ti] === ch) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found === -1) return null;
    indices.push(found);
    run = found === indices[indices.length - 2] + 1 ? run + 1 : 1;
    score += 10 + run * 4;
    // Bonus when the char starts a word boundary (space, dash, camel hump).
    if (found === 0 || /[\s\-_/]/.test(target[found - 1] || "")) score += 8;
    ti = found + 1;
  }
  // Stronger items win ties: shorter names are more precise hits.
  score += Math.max(0, 20 - name.length);
  return { score, indices };
}

function loadRecents(): string[] {
  try {
    const raw = safeLocalStorage.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecents(ids: string[]) {
  try {
    safeLocalStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, MAX_RECENTS)));
  } catch {
    /* storage unavailable — recents are a nicety, never a blocker */
  }
}

// Highlight the matched characters inside the rendered label.
function HighlightedName({ name, indices }: { name: string; indices: Set<number> }) {
  return (
    <span>
      {name.split("").map((ch, i) => (
        <span key={i} className={indices.has(i) ? "text-emerald-300 font-semibold" : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}

export default function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRecents(loadRecents());
      setQuery("");
      setSelected(0);
      // Focus after the enter animation starts so the input is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // --- Filtering: recents first (when the query is empty), then fuzzy score.
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const recentItems = recents
        .map((id) => items.find((it) => it.id === id))
        .filter((x): x is PaletteItem => Boolean(x));
      const rest = items.filter((it) => !recents.includes(it.id));
      const groups: { title: string; entries: { item: PaletteItem; indices: number[] }[] }[] = [];
      if (recentItems.length > 0) {
        groups.push({
          title: "TERBARU",
          entries: recentItems.map((item) => ({ item, indices: [] })),
        });
      }
      groups.push({
        title: "SEMUA PERINTAH",
        entries: rest.map((item) => ({ item, indices: [] })),
      });
      return groups;
    }
    const scored: { item: PaletteItem; indices: number[]; score: number }[] = [];
    for (const item of items) {
      const hay = item.keywords ? `${item.name} ${item.keywords}` : item.name;
      const hit = fuzzyScore(hay, q);
      if (hit) {
        // Clamp highlight indices to the visible name length.
        const clamped = hit.indices.filter((i) => i < item.name.length);
        scored.push({ item, indices: clamped, score: hit.score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const byGroup = new Map<string, { item: PaletteItem; indices: number[] }[]>();
    for (const s of scored.slice(0, 30)) {
      if (!byGroup.has(s.item.group)) byGroup.set(s.item.group, []);
      byGroup.get(s.item.group)!.push({ item: s.item, indices: s.indices });
    }
    return Array.from(byGroup.entries()).map(([title, entries]) => ({ title, entries }));
  }, [query, items, recents]);

  const flat = useMemo(() => filtered.flatMap((g) => g.entries), [filtered]);

  // Reset the cursor whenever the result set changes shape.
  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const commit = useCallback(
    (idx: number) => {
      const entry = flat[idx];
      if (!entry) return;
      saveRecents([entry.item.id, ...loadRecents().filter((id) => id !== entry.item.id)]);
      onClose();
      // Run the action AFTER the palette closes so navigations are not
      // re-rendered underneath the overlay during the exit animation.
      entry.item.action();
    },
    [flat, onClose]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setSelected((s) => (flat.length ? (s + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setSelected((s) => (flat.length ? (s - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSelected(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSelected(Math.max(0, flat.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(selected);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Prevent the page behind from scrolling while the modal is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette — navigasi cepat"
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-full max-w-xl bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden"
            onKeyDown={onKeyDown}
          >
            {/* Search row */}
            <div className="flex items-center gap-3 px-4 border-b border-slate-800">
              <Search className="w-4 h-4 text-slate-500 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari tab, perintah, atau tema…"
                className="w-full bg-transparent py-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                aria-label="Kueri pencarian command palette"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-palette-list"
                aria-activedescendant={flat[selected] ? `palette-item-${selected}` : undefined}
                spellCheck={false}
                autoComplete="off"
              />
              <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-[10px] font-mono text-slate-400 shrink-0">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} id="command-palette-list" role="listbox" aria-label="Hasil pencarian" className="max-h-[46vh] overflow-y-auto py-2 scroll-smooth">
              {flat.length === 0 && (
                <div className="px-4 py-8 text-center text-slate-500 text-sm">
                  Tidak ada perintah yang cocok dengan{" "}
                  <span className="font-mono text-slate-400">“{query.trim()}”</span>
                </div>
              )}
              {filtered.map((group) => (
                <div key={group.title} className="mb-1">
                  <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-600 font-semibold flex items-center gap-1.5">
                    {group.title === "TERBARU" ? (
                      <>
                        <Clock className="w-3 h-3" /> TERBARU
                      </>
                    ) : group.title === "SEMUA PERINTAH" ? (
                      <>
                        <Sparkles className="w-3 h-3" /> SEMUA PERINTAH
                      </>
                    ) : (
                      group.title
                    )}
                  </div>
                  {group.entries.map(({ item, indices }) => {
                    const idx = flat.findIndex((f) => f.item.id === item.id);
                    const isSelected = idx === selected;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        id={`palette-item-${idx}`}
                        data-idx={idx}
                        role="option"
                        aria-selected={isSelected}
                        onMouseMove={() => setSelected(idx)}
                        onClick={() => commit(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isSelected ? "bg-emerald-500/10 border-l-2 border-emerald-400" : "border-l-2 border-transparent hover:bg-slate-800/50"
                        }`}
                      >
                        {Icon && (
                          <Icon className={`w-4 h-4 shrink-0 ${isSelected ? "text-emerald-400" : "text-slate-500"}`} />
                        )}
                        <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">
                          <HighlightedName name={item.name} indices={new Set(indices)} />
                        </span>
                        {item.hint && (
                          <span className="hidden sm:block px-1.5 py-0.5 rounded border border-slate-700/70 bg-slate-800/50 text-[10px] font-mono text-slate-400 shrink-0">
                            {item.hint}
                          </span>
                        )}
                        {isSelected && (
                          <CornerDownLeft className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Footer legend */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-800 bg-slate-950/40 text-[10px] text-slate-500">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-slate-700 bg-slate-800/60 font-mono">
                    <ArrowUp className="w-2.5 h-2.5" />
                    <ArrowDown className="w-2.5 h-2.5" />
                  </kbd>
                  navigasi
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-slate-700 bg-slate-800/60 font-mono">
                    <CornerDownLeft className="w-2.5 h-2.5" />
                  </kbd>
                  jalankan
                </span>
              </div>
              <span className="font-mono">ZAYTRIX Command Palette</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
