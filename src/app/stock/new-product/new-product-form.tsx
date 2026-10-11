"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { NetworkError, postJson } from "@/client/api";
import { errorText } from "@/components/entry/entry-form";

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg outline-none focus:border-[#1f4e79]";
const label = "block text-sm font-medium text-stone-600";

/** A product, optionally in several colours/sizes (one stock line each). */
export function NewProductForm({ lang }: { lang: Lang }) {
  const t = messages(lang);
  const router = useRouter();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [variants, setVariants] = useState("");
  const [level, setLevel] = useState("10");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = variants.split(/[,،\n]/).map((v) => v.trim()).filter(Boolean);
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-5">
      <label className="block space-y-1.5">
        <span className={label}>{t.s.productName}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
      </label>
      <label className="block space-y-1.5">
        <span className={label}>{t.s.unit}</span>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} className={field} />
      </label>
      <label className="block space-y-1.5">
        <span className={label}>{t.s.variants}</span>
        <input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder={t.s.variantsHint} className={field} />
      </label>
      {name.trim() && list.length > 0 && <p className="text-sm text-stone-600">{list.map((v) => `${name.trim()} · ${v}`).join(", ")}</p>}
      <label className="block space-y-1.5">
        <span className={label}>{t.s.alertLevel}</span>
        <input inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
      </label>
      {err && <p className="rounded-xl bg-red-50 p-3 text-red-800">{err}</p>}
      <button
        disabled={busy || !name.trim()}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await postJson("/api/products", { name: name.trim(), unit: unit.trim() || "pcs", variants: list, lowStockLevel: level || "10" });
            if (!r.ok) return setErr(errorText(t, r.code));
            router.push("/stock");
            router.refresh();
          } catch (e) {
            setErr(e instanceof NetworkError ? t.err.NETWORK : t.err.UNKNOWN);
          } finally {
            setBusy(false);
          }
        }}
        className="w-full rounded-xl bg-[#2e7d4f] py-4 text-lg font-semibold text-white disabled:opacity-40"
      >
        {t.s.create}
      </button>
    </main>
  );
}
