"use client";

import { useState } from "react";
import { messages, type Lang } from "@/i18n/messages";
import { mfield, mlabel, PlaceFields, useManage } from "@/components/manage-ui";

export function CompanyEditor({ lang, company }: { lang: Lang; company: { name: string; city: string | null; state: string | null } }) {
  const t = messages(lang);
  const [name, setName] = useState(company.name);
  const [city, setCity] = useState(company.city ?? "");
  const [state, setState] = useState(company.state ?? "");
  const { act, busy, message } = useManage(t);
  const changed = name.trim() !== company.name || city.trim() !== (company.city ?? "") || state !== (company.state ?? "");
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-5">
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.name}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={mfield} />
        </label>
        <PlaceFields t={t} city={city} state={state} onCity={setCity} onState={setState} />
        <button
          disabled={busy || !changed || !name.trim()}
          onClick={() => act({ action: "company.update", name: name.trim(), city: city.trim() || null, state: state || null })}
          className="w-full rounded-xl bg-[#2e7d4f] py-3 text-lg font-semibold text-white disabled:opacity-40"
        >
          {t.m.save}
        </button>
      </div>
      {message}
    </main>
  );
}
