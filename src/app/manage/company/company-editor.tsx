"use client";

import { useState } from "react";
import { messages, type Lang } from "@/i18n/messages";
import { mfield, mlabel, PlaceFields, useManage } from "@/components/manage-ui";

interface Company {
  name: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  billPrefix: string | null;
}

const BILL_FIELDS = ["gstin", "address", "phone", "email", "bankName", "bankAccount", "bankIfsc", "upiId", "billPrefix"] as const;
type BillField = (typeof BILL_FIELDS)[number];

export function CompanyEditor({ lang, company }: { lang: Lang; company: Company }) {
  const t = messages(lang);
  const [name, setName] = useState(company.name);
  const [city, setCity] = useState(company.city ?? "");
  const [state, setState] = useState(company.state ?? "");
  const [bill, setBill] = useState<Record<BillField, string>>(() => Object.fromEntries(BILL_FIELDS.map((k) => [k, company[k] ?? ""])) as Record<BillField, string>);
  const { act, busy, message } = useManage(t);
  const changed = name.trim() !== company.name || city.trim() !== (company.city ?? "") || state !== (company.state ?? "");
  const billChanged = BILL_FIELDS.some((k) => bill[k].trim() !== (company[k] ?? ""));
  const set = (k: BillField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setBill((b) => ({ ...b, [k]: e.target.value }));
  const field = (k: Exclude<BillField, "address">, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block space-y-1.5">
      <span className={mlabel}>{label}</span>
      <input value={bill[k]} onChange={set(k)} className={mfield} {...extra} />
    </label>
  );
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      <div className="space-y-3 rounded-card bg-surface p-4 shadow-card">
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.name}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={mfield} />
        </label>
        <PlaceFields t={t} city={city} state={state} onCity={setCity} onState={setState} />
        <button
          disabled={busy || !changed || !name.trim()}
          onClick={() => act({ action: "company.update", name: name.trim(), city: city.trim() || null, state: state || null })}
          className="w-full rounded-control bg-go py-3 text-lg font-semibold text-ink-inverse disabled:opacity-40"
        >
          {t.m.save}
        </button>
      </div>

      <div className="space-y-3 rounded-card bg-surface p-4 shadow-card">
        <div>
          <h2 className="text-lg font-bold">🧾 {t.m.billDetails}</h2>
          <p className="text-sm text-ink-subtle">{t.m.billDetailsHint}</p>
        </div>
        {field("gstin", t.m.firmGstin, { autoCapitalize: "characters", maxLength: 17, placeholder: "03ABCDE1234F1Z5", className: `${mfield} font-mono` })}
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.billAddress}</span>
          <textarea value={bill.address} onChange={set("address")} rows={3} className={mfield} />
        </label>
        {field("phone", t.m.businessPhone, { inputMode: "tel" })}
        {field("email", t.m.businessEmail, { type: "email", inputMode: "email", autoCapitalize: "none" })}
        {field("bankName", t.m.bankName)}
        <div className="grid grid-cols-2 gap-3">
          {field("bankAccount", t.m.bankAccount, { inputMode: "numeric" })}
          {field("bankIfsc", t.m.bankIfsc, { autoCapitalize: "characters", maxLength: 11, placeholder: "SBIN0001234", className: `${mfield} font-mono` })}
        </div>
        {field("upiId", t.m.upiId, { autoCapitalize: "none", placeholder: "name@bank" })}
        {field("billPrefix", t.m.billPrefix, { autoCapitalize: "characters", maxLength: 8, placeholder: "SGT" })}
        <p className="text-sm text-ink-subtle">{t.m.billPrefixHint}</p>
        <button
          disabled={busy || !billChanged}
          onClick={() => act({ action: "company.update", ...Object.fromEntries(BILL_FIELDS.filter((k) => bill[k].trim() !== (company[k] ?? "")).map((k) => [k, bill[k].trim() || null])) })}
          className="w-full rounded-control bg-go py-3 text-lg font-semibold text-ink-inverse disabled:opacity-40"
        >
          {t.m.save}
        </button>
      </div>
      {message}
    </main>
  );
}
