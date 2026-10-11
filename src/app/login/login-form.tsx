"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { LangToggle } from "@/components/lang-toggle";

type Step = { kind: "phone" } | { kind: "code"; phone: string; devCode: string | null } | { kind: "company"; phone: string; code: string; companies: { id: string; name: string }[] };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as { ok: boolean; code?: string; [k: string]: unknown };
}

export function LoginForm({ initialLang, needsAccessCode }: { initialLang: Lang; needsAccessCode: boolean }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = messages(lang);
  const [step, setStep] = useState<Step>({ kind: "phone" });
  const [phone, setPhone] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showError = (c?: string) => setError(t.err[c ?? "UNKNOWN"] ?? t.err.UNKNOWN);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      showError("NETWORK");
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      const r = await post("/api/auth/request", { phone, accessCode });
      if (!r.ok) return showError(r.code);
      setCode("");
      setStep({ kind: "code", phone: r.phone as string, devCode: (r.devCode as string | null) ?? null });
    });

  const verify = (companyId?: string) =>
    run(async () => {
      const p = step.kind === "phone" ? phone : step.phone;
      const r = await post("/api/auth/verify", { phone: p, code: step.kind === "company" ? step.code : code, companyId });
      if (r.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (r.code === "CHOOSE_COMPANY") return setStep({ kind: "company", phone: p, code, companies: r.companies as { id: string; name: string }[] });
      showError(r.code);
    });

  const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3.5 text-xl outline-none focus:border-[#1f4e79] focus:ring-2 focus:ring-[#1f4e79]/20";
  const primary = "w-full rounded-xl bg-[#1f4e79] px-4 py-4 text-lg font-semibold text-white active:scale-[.99] disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-[#1f4e79]">{t.appName}</h1>
        <LangToggle lang={lang} onChange={(l) => { setLang(l); document.cookie = `ob_lang=${l}; path=/; max-age=31536000`; }} />
      </div>

      {step.kind === "phone" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-stone-600">{t.phoneLabel}</span>
            <input className={field} type="tel" inputMode="tel" autoComplete="tel" placeholder={t.phonePlaceholder} value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </label>
          {needsAccessCode && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-stone-600">{t.accessCodeLabel}</span>
              <input className={field} value={accessCode} onChange={(e) => setAccessCode(e.target.value)} autoComplete="off" required />
              <span className="block text-xs text-stone-500">{t.accessCodeHint}</span>
            </label>
          )}
          <button className={primary} disabled={busy}>{t.sendCode}</button>
        </form>
      )}

      {step.kind === "code" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <p className="text-stone-600">
            {t.codeSentTo} <span className="font-semibold text-stone-900">{step.phone}</span>
          </p>
          {step.devCode && (
            <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
              {t.devCodeNote} <span className="font-mono text-2xl font-bold tracking-widest">{step.devCode}</span>
            </p>
          )}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-stone-600">{t.codeLabel}</span>
            <input className={`${field} text-center font-mono text-3xl tracking-[.4em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required />
          </label>
          <button className={primary} disabled={busy || code.length !== 6}>{t.verify}</button>
          <button type="button" className="w-full py-2 text-[#1f4e79]" onClick={() => setStep({ kind: "phone" })}>{t.changeNumber}</button>
        </form>
      )}

      {step.kind === "company" && (
        <div className="space-y-3">
          <p className="text-lg font-semibold">{t.chooseCompany}</p>
          {step.companies.map((c) => (
            <button key={c.id} className={primary} disabled={busy} onClick={() => verify(c.id)}>{c.name}</button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    </div>
  );
}
