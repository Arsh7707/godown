"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { AliasEditor, HideDelete, mfield, mlabel, PlaceFields, useManage } from "@/components/manage-ui";
import { postJson } from "@/client/api";

type TaxType = "" | "gstin" | "aadhaar";
interface Party {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  taxIdType: "gstin" | "aadhaar" | null;
  /** GSTIN in full, Aadhaar masked. */
  taxId: string | null;
  active: boolean;
  aliases: { id: string; alias: string }[];
}

export function ClientEditor({ lang, party, canDelete }: { lang: Lang; party: Party; canDelete: boolean }) {
  const t = messages(lang);
  const router = useRouter();
  const [name, setName] = useState(party.name);
  const [phone, setPhone] = useState(party.phone ?? "");
  const [city, setCity] = useState(party.city ?? "");
  const [state, setState] = useState(party.state ?? "");
  const [taxType, setTaxType] = useState<TaxType>(party.taxIdType ?? "");
  // GSTIN starts filled in; Aadhaar starts empty (only the masked number is known) and is typed again to replace it.
  const [taxId, setTaxId] = useState(party.taxIdType === "gstin" ? (party.taxId ?? "") : "");
  const [revealed, setRevealed] = useState<string | null>(null);
  const { act, busy, message } = useManage(t);
  const taxChanged = taxType !== (party.taxIdType ?? "") || (taxType === "gstin" && taxId.trim().toUpperCase() !== (party.taxId ?? "")) || (taxType === "aadhaar" && taxId.trim() !== "");
  const changed = name.trim() !== party.name || phone.trim() !== (party.phone ?? "") || city.trim() !== (party.city ?? "") || state !== (party.state ?? "") || taxChanged;
  const taxReady = !taxChanged || taxType === "" || taxId.trim() !== "";
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-5 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      <div className="space-y-3 rounded-card bg-surface p-4 shadow-card">
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.name}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={mfield} />
        </label>
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.phone}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={mfield} />
        </label>
        <PlaceFields t={t} city={city} state={state} onCity={setCity} onState={setState} />
        <div className="space-y-1.5">
          <span className={mlabel}>{t.m.taxId}</span>
          <div className="grid grid-cols-3 gap-2">
            {(["", "gstin", "aadhaar"] as TaxType[]).map((k) => (
              <button
                key={k || "none"}
                type="button"
                onClick={() => {
                  setTaxType(k);
                  setTaxId(k === "gstin" && party.taxIdType === "gstin" ? (party.taxId ?? "") : "");
                }}
                className={`rounded-control border-2 py-2.5 font-semibold ${taxType === k ? "border-brand bg-brand text-ink-inverse" : "border-line-strong"}`}
              >
                {k === "gstin" ? t.m.gstin : k === "aadhaar" ? t.m.aadhaar : t.m.taxNone}
              </button>
            ))}
          </div>
          {taxType === "aadhaar" && party.taxIdType === "aadhaar" && (
            <p className="flex items-center justify-between rounded-control bg-sunken px-3 py-2 font-mono">
              {revealed ?? party.taxId}
              {!revealed && (
                <button
                  type="button"
                  className="font-sans text-sm font-semibold text-brand underline"
                  onClick={async () => {
                    const r = await postJson<{ taxId: string }>("/api/manage", { action: "party.taxid.reveal", id: party.id }).catch(() => null);
                    if (r?.ok) setRevealed(r.taxId.replace(/(\d{4})(?=\d)/g, "$1 "));
                  }}
                >
                  {t.m.reveal}
                </button>
              )}
            </p>
          )}
          {taxType && (
            <input
              value={taxId}
              onChange={(e) => setTaxId(taxType === "gstin" ? e.target.value.toUpperCase() : e.target.value)}
              inputMode={taxType === "aadhaar" ? "numeric" : "text"}
              autoCapitalize="characters"
              maxLength={taxType === "aadhaar" ? 14 : 17}
              placeholder={taxType === "gstin" ? "03ABCDE1234F1Z5" : party.taxIdType === "aadhaar" ? t.m.replaceTaxId : "1234 5678 9012"}
              className={`${mfield} font-mono`}
            />
          )}
          {taxType && <p className="text-sm text-ink-subtle">{taxType === "gstin" ? t.m.gstinHint : t.m.aadhaarHint}</p>}
        </div>
        {name.trim() !== party.name && <p className="text-sm text-ink-subtle">{t.m.renameNote}</p>}
        <button
          disabled={busy || !changed || !name.trim() || !taxReady}
          onClick={() =>
            act({
              action: "party.update",
              id: party.id,
              name: name.trim(),
              phone: phone.trim(),
              city: city.trim() || null,
              state: state || null,
              ...(taxChanged ? { taxIdType: taxType || null, taxId: taxType ? taxId.trim() : null } : {}),
            })
          }
          className="w-full rounded-control bg-go py-3 text-lg font-semibold text-ink-inverse disabled:opacity-40"
        >
          {t.m.save}
        </button>
      </div>
      {message}
      <div className="rounded-card bg-surface p-4 shadow-card">
        <AliasEditor t={t} aliases={party.aliases} busy={busy} onAdd={(alias) => act({ action: "party.alias.add", id: party.id, alias })} onRemove={(aliasId) => act({ action: "party.alias.remove", aliasId })} />
      </div>
      <Link href={`/pending/party/${party.id}`} className="block rounded-control border-2 border-line-strong py-3 text-center font-semibold">
        📋 {t.m.openPending}
      </Link>
      <HideDelete
        t={t}
        busy={busy}
        active={party.active}
        canDelete={canDelete}
        onToggle={() => act({ action: "party.update", id: party.id, active: !party.active })}
        onDelete={() => act({ action: "party.delete", id: party.id }, () => router.push("/manage/clients"))}
      />
    </main>
  );
}
