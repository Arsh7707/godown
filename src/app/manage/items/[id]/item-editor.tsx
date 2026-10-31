"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { messages, type Lang } from "@/i18n/messages";
import { formatQty } from "@/lib/qty";
import { AliasEditor, HideDelete, mfield, mlabel, useManage } from "@/components/manage-ui";

const num = (c: number | null) => (c === null ? "—" : c < 0 ? `−${formatQty(-c)}` : formatQty(c));

interface Item {
  id: string;
  name: string;
  product: string;
  variant: string | null;
  unit: string;
  active: boolean;
  lowStockLevel: string;
  inStock: number | null;
  free: number | null;
  aliases: { id: string; alias: string }[];
}

export function ItemEditor({ lang, item, used, siblings }: { lang: Lang; item: Item; used: boolean; siblings: number }) {
  const t = messages(lang);
  const router = useRouter();
  const { act, busy, message } = useManage(t);
  const [product, setProduct] = useState(item.product);
  const [variant, setVariant] = useState(item.variant ?? "");
  const [unit, setUnit] = useState(item.unit);
  const [level, setLevel] = useState(item.lowStockLevel);
  const [newColour, setNewColour] = useState("");
  const grouped = siblings > 1 || !!item.variant;

  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-5 px-4 pt-4 pb-[calc(var(--tabbar-space)+1.5rem)]">
      <Link href={`/stock/item/${item.id}`} className="flex items-center justify-between rounded-card bg-surface p-4 shadow-card">
        <span className="font-semibold">📦 {t.m.openStock}</span>
        <span className="tabular-nums">
          {t.s.inStock} <b>{num(item.inStock)}</b> · {t.s.free} <b>{num(item.free)}</b>
        </span>
      </Link>

      <div className="space-y-3 rounded-card bg-surface p-4 shadow-card">
        <label className="block space-y-1.5">
          <span className={mlabel}>{grouped ? t.m.product : t.m.name}</span>
          <div className="flex gap-2">
            <input value={product} onChange={(e) => setProduct(e.target.value)} className={mfield} />
            <button
              disabled={busy || !product.trim() || product.trim() === item.product}
              onClick={() => act(grouped ? { action: "product.rename", product: item.product, name: product.trim() } : { action: "item.update", id: item.id, name: product.trim() })}
              className="shrink-0 rounded-control bg-go px-4 font-semibold text-ink-inverse disabled:opacity-40"
            >
              {t.m.save}
            </button>
          </div>
        </label>
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.variant}</span>
          <div className="flex gap-2">
            <input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder={t.m.noVariant} className={mfield} />
            <button disabled={busy || variant.trim() === (item.variant ?? "")} onClick={() => act({ action: "item.update", id: item.id, variant: variant.trim() })} className="shrink-0 rounded-control bg-go px-4 font-semibold text-ink-inverse disabled:opacity-40">
              {t.m.save}
            </button>
          </div>
        </label>
        <p className="text-sm text-ink-subtle">{t.m.renameNote}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-card bg-surface p-4 shadow-card">
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.unit}</span>
          <input value={unit} disabled={used} onChange={(e) => setUnit(e.target.value)} className={mfield} />
          {used && <span className="block text-sm text-ink-subtle">{t.m.unitLocked}</span>}
        </label>
        <label className="block space-y-1.5">
          <span className={mlabel}>{t.m.alertLevel}</span>
          <input value={level} inputMode="decimal" onChange={(e) => setLevel(e.target.value.replace(/[^\d.]/g, ""))} className={mfield} />
        </label>
        <button
          disabled={busy || (unit.trim() === item.unit && level === item.lowStockLevel) || !level}
          onClick={() => act({ action: "item.update", id: item.id, ...(unit.trim() !== item.unit ? { unit: unit.trim() } : {}), lowStockLevel: level })}
          className="col-span-2 rounded-control bg-go py-3 font-semibold text-ink-inverse disabled:opacity-40"
        >
          {t.m.save}
        </button>
      </div>

      {message}

      <div className="rounded-card bg-surface p-4 shadow-card">
        <AliasEditor t={t} aliases={item.aliases} busy={busy} onAdd={(alias) => act({ action: "item.alias.add", id: item.id, alias })} onRemove={(aliasId) => act({ action: "item.alias.remove", aliasId })} />
      </div>

      <div className="space-y-2 rounded-card bg-surface p-4 shadow-card">
        <span className={mlabel}>
          {t.m.addColour} · {item.product}
        </span>
        <div className="flex gap-2">
          <input value={newColour} onChange={(e) => setNewColour(e.target.value)} placeholder={t.s.variantsHint} className={mfield} />
          <button
            disabled={busy || !newColour.trim()}
            onClick={() => act({ action: "product.addVariant", product: item.product, variant: newColour.trim() }, (r) => router.push(`/manage/items/${r.id}`))}
            className="shrink-0 rounded-control bg-brand px-5 text-xl font-semibold text-ink-inverse disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      <HideDelete
        t={t}
        busy={busy}
        active={item.active}
        canDelete={!used}
        onToggle={() => act({ action: "item.update", id: item.id, active: !item.active })}
        onDelete={() => act({ action: "item.delete", id: item.id }, () => router.push("/manage/items"))}
      />
    </main>
  );
}
