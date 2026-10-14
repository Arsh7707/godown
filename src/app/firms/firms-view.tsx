"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { messages, type Lang, type Messages } from "@/i18n/messages";
import type { Firm } from "@/masters/firms";
import { NetworkError, postJson } from "@/client/api";
import { switchFirm } from "@/client/firm";
import { errorText } from "@/components/entry/entry-form";
import { mfield, mlabel, PlaceFields } from "@/components/manage-ui";

function useAct(t: Messages) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(fn: () => Promise<{ ok: boolean; code?: string; details?: Record<string, unknown> } | undefined>, okText?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r && !r.ok) setMsg({ ok: false, text: errorText(t, r.code ?? "UNKNOWN", r.details) });
      else if (okText) setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN });
    } finally {
      setBusy(false);
    }
  }
  const message = msg && <p className={`rounded-xl p-3 ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{msg.text}</p>;
  return { run, busy, message };
}

/** Firms the stock of `firm` may come from: other firms with their own stock, where this person is owner. */
function stockChoices(firms: Firm[], firm: Firm | null) {
  return firms.filter((f) => f.role === "owner" && !f.stockCompanyId && f.companyId !== firm?.companyId);
}

function StockLine({ t, f }: { t: Messages; f: Firm }) {
  return (
    <p className="text-sm text-stone-600">
      📦 {f.stockCompanyId ? `${t.f.usesStockOf} ${f.stockName ?? "?"}` : t.f.ownStock}
      {f.sharedBy.length > 0 && ` · ${t.f.sharedWith} ${f.sharedBy.join(", ")}`}
    </p>
  );
}

function StockEditor({ t, firm, firms }: { t: Messages; firm: Firm; firms: Firm[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(firm.stockCompanyId ?? "");
  const { run, busy, message } = useAct(t);
  const choices = stockChoices(firms, firm);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="text-sm font-semibold text-[#1f4e79] underline">
        {t.f.changeStock}
      </button>
    );
  return (
    <div className="space-y-2 rounded-xl bg-stone-50 p-3">
      <select value={choice} onChange={(e) => setChoice(e.target.value)} className={`${mfield} px-2`}>
        <option value="">{t.f.ownStock}</option>
        {choices.map((c) => (
          <option key={c.companyId} value={c.companyId}>
            {t.f.useStockOf} {c.name}
          </option>
        ))}
      </select>
      <p className="text-xs text-stone-500">{t.f.stockRule}</p>
      <div className="flex gap-2">
        <button
          disabled={busy || choice === (firm.stockCompanyId ?? "")}
          onClick={() =>
            run(async () => {
              const r = await postJson("/api/firm", { action: "stock", companyId: firm.companyId, stockCompanyId: choice || null }, { firm: null });
              if (r.ok) {
                setOpen(false);
                // The open firm's items and stock may have changed: reload everything.
                if (firm.current) window.location.reload();
                else router.refresh();
              }
              return r;
            }, t.m.saved)
          }
          className="flex-1 rounded-xl bg-[#2e7d4f] py-2.5 font-semibold text-white disabled:opacity-40"
        >
          {t.m.save}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-xl border-2 border-stone-300 px-4 font-semibold">
          {t.f.cancel}
        </button>
      </div>
      {message}
    </div>
  );
}

function AddFirm({ t, firms, currentName }: { t: Messages; firms: Firm[]; currentName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [stock, setStock] = useState("");
  const [copyTeam, setCopyTeam] = useState(false);
  const { run, busy, message } = useAct(t);
  const choices = stockChoices(firms, null);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="w-full rounded-2xl border-2 border-dashed border-[#1f4e79]/40 py-5 text-lg font-semibold text-[#1f4e79]">
        ＋ {t.f.add}
      </button>
    );
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-lg font-bold">{t.f.add}</p>
      <label className="block space-y-1.5">
        <span className={mlabel}>{t.f.name}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={mfield} maxLength={80} autoFocus />
      </label>
      <PlaceFields t={t} city={city} state={state} onCity={setCity} onState={setState} />
      <fieldset className="space-y-2">
        <legend className={mlabel}>{t.f.stockQ}</legend>
        <label className="flex items-start gap-3 rounded-xl border-2 border-stone-200 p-3 has-[:checked]:border-[#1f4e79]">
          <input type="radio" name="stock" checked={stock === ""} onChange={() => setStock("")} className="mt-1 size-5" />
          <span>
            <span className="block font-semibold">{t.f.ownStock}</span>
            <span className="block text-sm text-stone-500">{t.f.ownStockHint}</span>
          </span>
        </label>
        {choices.map((c) => (
          <label key={c.companyId} className="flex items-start gap-3 rounded-xl border-2 border-stone-200 p-3 has-[:checked]:border-[#1f4e79]">
            <input type="radio" name="stock" checked={stock === c.companyId} onChange={() => setStock(c.companyId)} className="mt-1 size-5" />
            <span>
              <span className="block font-semibold">
                {t.f.useStockOf} {c.name}
              </span>
              <span className="block text-sm text-stone-500">{t.f.sharedHint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={copyTeam} onChange={(e) => setCopyTeam(e.target.checked)} className="size-5" />
        <span>
          {t.f.copyTeam} <b>{currentName}</b>
        </span>
      </label>
      <button
        disabled={busy || !name.trim()}
        onClick={() =>
          run(async () => {
            const r = await postJson<{ companyId: string }>(
              "/api/firm",
              { action: "create", name: name.trim(), city: city.trim() || null, state: state || null, stockCompanyId: stock || null, copyTeam },
              { firm: null },
            );
            // Created and opened: start in the new firm.
            if (r.ok) window.location.href = "/";
            return r;
          })
        }
        className="w-full rounded-xl bg-[#2e7d4f] py-3 text-lg font-semibold text-white disabled:opacity-40"
      >
        {t.f.create}
      </button>
      {message}
    </div>
  );
}

/** All firms of this person: switch, add, own stock or shared godown. */
export function FirmsView({ lang, firms, canAdd, currentName }: { lang: Lang; firms: Firm[]; canAdd: boolean; currentName: string }) {
  const t = messages(lang);
  const { run, busy, message } = useAct(t);
  const roleLabel = { owner: t.m.roleOwner, staff: t.m.roleStaff, viewer: t.m.roleViewer };
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 py-5">
      <p className="text-stone-600">{t.f.hint}</p>
      {message}
      {firms.map((f) => (
        <div key={f.companyId} className={`space-y-2 rounded-2xl bg-white p-4 shadow-sm ${f.current ? "ring-2 ring-[#1f4e79]" : ""}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xl font-bold">🏢 {f.name}</p>
              <p className="text-sm text-stone-500">
                {[f.city, roleLabel[f.role]].filter(Boolean).join(" · ")}
              </p>
            </div>
            {f.current ? (
              <span className="shrink-0 rounded-full bg-[#1f4e79]/10 px-3 py-1 text-sm font-semibold text-[#1f4e79]">{t.f.openNow}</span>
            ) : (
              <button disabled={busy} onClick={() => run(() => switchFirm(f.companyId, "/"))} className="shrink-0 rounded-xl bg-[#1f4e79] px-4 py-2.5 font-semibold text-white disabled:opacity-40">
                {t.f.open}
              </button>
            )}
          </div>
          <StockLine t={t} f={f} />
          {f.role === "owner" && <StockEditor t={t} firm={f} firms={firms} />}
        </div>
      ))}
      {canAdd ? <AddFirm t={t} firms={firms} currentName={currentName} /> : <p className="text-sm text-stone-500">{t.f.onlyOwnersAdd}</p>}
    </main>
  );
}
