"use client";

import { useMemo, useState } from "react";
import { similarity, type Candidate } from "@/extraction/matcher";
import type { Messages } from "@/i18n/messages";
import { Icon } from "../ui/icons";
import { inputClass } from "../ui/field";

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
  const row = "flex min-h-14 w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left text-lg active:bg-sunken";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface [animation:sheet-up_.2s_cubic-bezier(.2,.8,.2,1)]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="border-b border-line bg-canvas px-3 pt-[max(.5rem,env(safe-area-inset-top))] pb-3">
        <div className="flex min-h-12 items-center gap-2">
          <button type="button" onClick={onClose} className="min-h-12 rounded-control px-3 font-semibold text-brand active:bg-brand-soft">
            {t.e.cancel}
          </button>
          <h2 className="min-w-0 flex-1 text-lg font-bold break-words">{title}</h2>
        </div>
        <input autoFocus aria-label={t.e.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.e.search} className={inputClass(false, "mt-2")} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {!q && suggested.length > 0 && (
          <>
            <p className="bg-status-pending-bg px-4 py-2 text-sm font-semibold text-status-pending">{t.e.suggested}</p>
            {suggested.map((c) => (
              <button key={`s-${c.id}`} className={row} onClick={() => onPick(c.id)}>
                <span>{c.name}</span>
                <span className="text-sm text-ink-subtle">{Math.round(c.score * 100)}%</span>
              </button>
            ))}
            <p className="bg-sunken px-4 py-2 text-sm font-semibold text-ink-subtle">{t.e.allNames}</p>
          </>
        )}
        {list.map((o) => (
          <button key={o.id} className={row} onClick={() => onPick(o.id)}>
            <span>{o.name}</span>
            {o.sub && <span className="text-sm text-ink-subtle">{o.sub}</span>}
          </button>
        ))}
        {onCreate && q.trim() && !exact && (
          <div className="space-y-3 p-4">
            {askUnit && (
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-ink-muted">{t.e.newUnit}</span>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass()} />
              </label>
            )}
            <button
              disabled={busy}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-control border-2 border-dashed border-brand px-4 py-3 text-lg font-semibold text-brand disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                try {
                  await onCreate(q.trim(), askUnit ? unit.trim() || "pcs" : undefined);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="plus" size={22} />
              {t.e.addNew}: “{q.trim()}”
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
