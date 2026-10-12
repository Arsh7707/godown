import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { orderDetail, partyOrders } from "@/ledger/queries";
import { pastDay, todayIST } from "@/lib/dates";
import { formatQty } from "@/lib/qty";
import { EntryScreen } from "@/components/entry/entry-screen";
import type { FormState } from "@/components/entry/form-state";

export default async function NewDispatchPage({ searchParams }: PageProps<"/dispatch/new">) {
  const user = await requireUser();
  if (user.role === "viewer") redirect("/");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const today = todayIST();
  const day = pastDay(one(sp.date));

  // Dispatch against a pending order: start with its remaining items filled in.
  let prefill: FormState | undefined;
  const orderId = one(sp.order);
  if (orderId) {
    const o = await orderDetail(db, ctxFor(user), orderId).catch(() => null);
    const open = o?.lines.filter((l) => l.balance > 0) ?? [];
    if (o && open.length) {
      prefill = {
        partyId: o.party.id,
        partyMention: null,
        partyCandidates: [],
        date: day ?? today,
        promisedDate: "",
        takenBy: "",
        transport: "",
        lrNumber: "",
        notes: "",
        lines: open.map((l) => ({ key: l.orderLineId, itemId: l.itemId, mention: null, candidates: [], quantity: formatQty(l.balance), unitSaid: null, unit: l.unitCode })),
      };
    }
  }
  // Dispatch for a party from Pending: all of its pending items, oldest orders counted first.
  const partyId = one(sp.party);
  if (!prefill && partyId) {
    const po = await partyOrders(db, ctxFor(user), partyId).catch(() => null);
    const byItem = new Map<string, { itemId: string; unit: string | null; bal: number }>();
    for (const o of po?.open ?? [])
      for (const l of o.lines) {
        if (l.balance <= 0) continue;
        const k = `${l.itemId}|${l.unitCode ?? ""}`;
        const cur = byItem.get(k) ?? { itemId: l.itemId, unit: l.unitCode, bal: 0 };
        cur.bal += l.balance;
        byItem.set(k, cur);
      }
    if (po && byItem.size) {
      prefill = {
        partyId,
        partyMention: null,
        partyCandidates: [],
        date: day ?? today,
        promisedDate: "",
        takenBy: "",
        transport: "",
        lrNumber: "",
        notes: "",
        lines: [...byItem].map(([k, x]) => ({ key: k, itemId: x.itemId, mention: null, candidates: [], quantity: formatQty(x.bal), unitSaid: null, unit: x.unit })),
      };
    }
  }
  return <EntryScreen kind="dispatch" lang={user.language} today={today} day={day} resume={one(sp.resume)} fix={one(sp.fix)} shared={one(sp.shared)} prefill={prefill} />;
}
