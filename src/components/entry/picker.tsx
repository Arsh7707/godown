"use client";

import { useMemo, useState } from "react";
import { similarity, type Candidate } from "@/extraction/matcher";
import type { Messages } from "@/i18n/messages";

interface Option {
  id: string;
  name: string;
  aliases: string[];
  sub?: string;
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

/** Full-screen chooser: suggestions first, then searchable full list, then "add new". */
export function Picker({
  t,
  title,
  options,
  suggested,
  initialQuery,
  onPick,
  onCreate,
  askUnit,
  onClose,
}: {
  t: Messages;
  title: string;
  options: Option[];
  suggested: Candidate[];
  initialQuery?: string;
  onPick: (id: string) => void;
  onCreate?: (name: string, unit?: string) => Promise<void>;
  askUnit?: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [unit, setUnit] = useState("pcs");
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => {
    const n = norm(q);
    if (!n) return options;
    const direct = options.filter((o) => [o.name, ...o.aliases].some((s) => norm(s).includes(n)));
    if (n.length < 3) return direct;
    // Then names that are close in spelling or sound (typos, Hinglish, Hindi vs English letters).
    const have = new Set(direct.map((o) => o.id));
    const close = options
      .filter((o) => !have.has(o.id))
      .map((o) => ({ o, score: Math.max(...[o.name, ...o.aliases].map((s) => similarity(q, s))) }))
      .filter((x) => x.score >= 0.75)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.o);
    return [...direct, ...close];
  }, [q, options]);
  const exact = options.some((o) => norm(o.name) === norm(q));
  const row = "flex w-full items-center justify-between gap-3 border-b border-stone-100 px-4 py-4 text-left text-lg active:bg-stone-100";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label={title}>
      <div className="flex items-center gap-2 border-b border-stone-200 p-3 pt-[max(.75rem,env(safe-area-inset-top))]">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-[#1f4e79]">
          {t.e.cancel}
        </button>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.e.search} className="min-w-0 flex-1 rounded-xl border border-stone-300 px-4 py-3 text-lg outline-none focus:border-[#1f4e79]" />
      </div>
      <div className="flex-1 overflow-y-auto">
        {!q && suggested.length > 0 && (
          <>
            <p className="bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">{t.e.suggested}</p>
            {suggested.map((c) => (
              <button key={`s-${c.id}`} className={row} onClick={() => onPick(c.id)}>
                <span>{c.name}</span>
                <span className="text-sm text-stone-400">{Math.round(c.score * 100)}%</span>
              </button>
            ))}
            <p className="bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-500">{t.e.allNames}</p>
          </>
        )}
        {list.map((o) => (
          <button key={o.id} className={row} onClick={() => onPick(o.id)}>
            <span>{o.name}</span>
            {o.sub && <span className="text-sm text-stone-400">{o.sub}</span>}
          </button>
        ))}
        {onCreate && q.trim() && !exact && (
          <div className="space-y-3 p-4">
            {askUnit && (
              <label className="block space-y-1">
                <span className="text-sm text-stone-600">{t.e.newUnit}</span>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full rounded-xl border border-stone-300 px-4 py-3 text-lg" />
              </label>
            )}
            <button
              disabled={busy}
              className="w-full rounded-xl border-2 border-dashed border-[#1f4e79] px-4 py-4 text-lg font-semibold text-[#1f4e79] disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                try {
                  await onCreate(q.trim(), askUnit ? unit.trim() || "pcs" : undefined);
                } finally {
                  setBusy(false);
                }
              }}
            >
              + {t.e.addNew}: “{q.trim()}”
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
