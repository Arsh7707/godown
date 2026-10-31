"use client";

import { useState } from "react";
import { messages, type Lang, type Messages } from "@/i18n/messages";
import { formatPhone } from "@/lib/phone";
import { mfield, mlabel, PlaceFields, useManage } from "@/components/manage-ui";

type Role = "owner" | "staff" | "viewer";
interface Person {
  id: string;
  name: string;
  phone: string;
  role: Role;
  city: string | null;
  state: string | null;
  stockKeeper: boolean;
  active: boolean;
}

const roleLabel = (t: Messages, r: Role) => ({ owner: t.m.roleOwner, staff: t.m.roleStaff, viewer: t.m.roleViewer })[r];

export function TeamEditor({ lang, me, team }: { lang: Lang; me: string; team: Person[] }) {
  const t = messages(lang);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-3 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      {team.map((p) =>
        open === p.id ? (
          <PersonForm key={p.id} t={t} person={p} isMe={p.id === me} onClose={() => setOpen(null)} />
        ) : (
          <button key={p.id} onClick={() => setOpen(p.id)} className={`block w-full rounded-card bg-surface p-4 text-left shadow-card active:bg-sunken ${p.active ? "" : "opacity-50"}`}>
            <p className="text-lg font-bold">
              {p.name} {p.id === me && <span className="text-sm font-normal text-ink-subtle">({t.m.you})</span>}
            </p>
            <p className="text-sm text-ink-subtle">
              {[formatPhone(p.phone), roleLabel(t, p.role), p.stockKeeper ? `📦 ${t.m.stockKeeper}` : null, [p.city, p.state].filter(Boolean).join(", ") || null, p.active ? null : t.m.noAccess]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </button>
        ),
      )}
      {open === "new" ? (
        <PersonForm t={t} person={null} isMe={false} onClose={() => setOpen(null)} />
      ) : (
        <button onClick={() => setOpen("new")} className="w-full rounded-card border-2 border-dashed border-line-strong py-4 text-lg font-semibold text-ink-muted">
          + {t.m.addPerson}
        </button>
      )}
    </main>
  );
}

function PersonForm({ t, person, isMe, onClose }: { t: Messages; person: Person | null; isMe: boolean; onClose: () => void }) {
  const [name, setName] = useState(person?.name ?? "");
  const [phone, setPhone] = useState(person ? formatPhone(person.phone) : "");
  const [role, setRole] = useState<Role>(person?.role ?? "staff");
  const [city, setCity] = useState(person?.city ?? "");
  const [state, setState] = useState(person?.state ?? "");
  const [stockKeeper, setStockKeeper] = useState(person?.stockKeeper ?? false);
  const { act, busy, message } = useManage(t);
  const fields = { name: name.trim(), phone: phone.trim(), role, city: city.trim() || null, state: state || null, stockKeeper };
  return (
    <div className="space-y-3 rounded-card border-2 border-brand/30 bg-surface p-4 shadow-card">
      <label className="block space-y-1.5">
        <span className={mlabel}>{t.m.name}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={mfield} />
      </label>
      <label className="block space-y-1.5">
        <span className={mlabel}>{t.m.personPhone}</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" className={mfield} />
      </label>
      <label className="block space-y-1.5">
        <span className={mlabel}>{t.m.role}</span>
        <select value={role} disabled={isMe} onChange={(e) => setRole(e.target.value as Role)} className={mfield}>
          {(["owner", "staff", "viewer"] as Role[]).map((r) => (
            <option key={r} value={r}>
              {roleLabel(t, r)}
            </option>
          ))}
        </select>
      </label>
      <PlaceFields t={t} city={city} state={state} onCity={setCity} onState={setState} />
      <label className="flex items-start gap-3 rounded-control bg-sunken p-3">
        <input type="checkbox" checked={stockKeeper} onChange={(e) => setStockKeeper(e.target.checked)} className="mt-1 size-5" />
        <span>
          <span className="block font-semibold">📦 {t.m.stockKeeper}</span>
          <span className="block text-sm text-ink-subtle">{t.m.stockKeeperHint}</span>
        </span>
      </label>
      {message}
      <div className="flex gap-2">
        <button
          disabled={busy || !name.trim() || !phone.trim()}
          onClick={() => act(person ? { action: "user.update", id: person.id, ...fields, ...(isMe ? { role: undefined } : {}) } : { action: "user.add", ...fields }, () => onClose())}
          className="flex-1 rounded-control bg-go py-3 text-lg font-semibold text-ink-inverse disabled:opacity-40"
        >
          {t.m.save}
        </button>
        <button onClick={onClose} className="rounded-control border-2 border-line-strong px-4 font-semibold">
          ✕
        </button>
      </div>
      {person && !isMe && (
        <button disabled={busy} onClick={() => act({ action: "user.update", id: person.id, active: !person.active }, () => onClose())} className="w-full rounded-control border-2 border-danger/30 py-2.5 font-semibold text-danger">
          {person.active ? t.m.removeAccess : t.m.giveAccess}
        </button>
      )}
    </div>
  );
}
