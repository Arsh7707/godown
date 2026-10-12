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
    <main className="mx-auto w-full max-w-md flex-1 space-y-5 px-4 py-5">
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
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
                className={`rounded-xl border-2 py-2.5 font-semibold ${taxType === k ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-stone-300"}`}
              >
                {k === "gstin" ? t.m.gstin : k === "aadhaar" ? t.m.aadhaar : t.m.taxNone}
              </button>
            ))}
          </div>
          {taxType === "aadhaar" && party.taxIdType === "aadhaar" && (
            <p className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 font-mono">
              {revealed ?? party.taxId}
              {!revealed && (
                <button
                  type="button"
                  className="font-sans text-sm font-semibold text-[#1f4e79] underline"
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
          {taxType && <p className="text-xs text-stone-500">{taxType === "gstin" ? t.m.gstinHint : t.m.aadhaarHint}</p>}
        </div>
        {name.trim() !== party.name && <p className="text-xs text-stone-500">{t.m.renameNote}</p>}
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
          className="w-full rounded-xl bg-[#2e7d4f] py-3 text-lg font-semibold text-white disabled:opacity-40"
        >
          {t.m.save}
        </button>
      </div>
      {message}
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <AliasEditor t={t} aliases={party.aliases} busy={busy} onAdd={(alias) => act({ action: "party.alias.add", id: party.id, alias })} onRemove={(aliasId) => act({ action: "party.alias.remove", aliasId })} />
      </div>
      <Link href={`/pending/party/${party.id}`} className="block rounded-xl border-2 border-stone-300 py-3 text-center font-semibold">
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
