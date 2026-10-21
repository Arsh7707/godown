import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { orderDetail } from "@/ledger/queries";
import { LedgerError } from "@/lib/errors";
import { formatQty } from "@/lib/qty";
import { todayIST } from "@/lib/dates";
import { messages } from "@/i18n/messages";
import { EditScreen } from "@/components/entry/edit-screen";

export default async function EditOrderPage({ params }: PageProps<"/orders/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  const t = messages(user.language);
  const o = await orderDetail(db, ctxFor(user), id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  if (!o.canChange) redirect(`/orders/${id}`);
  return (
    <EditScreen
      kind="order"
      lang={user.language}
      today={todayIST()}
      title={`${t.e.edit}: ${o.party.name}`}
      backHref={`/orders/${id}`}
      mode={{ type: "correctOrder", orderId: id, baseRev: o.rev }}
      initial={{
        partyId: o.party.id,
        partyMention: null,
        partyCandidates: [],
        date: o.orderDate,
        promisedDate: o.promisedDate ?? "",
        takenBy: "",
        transport: "",
        lrNumber: "",
        notes: o.notes ?? "",
        lines: o.lines.map((l) => ({ key: l.orderLineId, orderLineId: l.orderLineId, itemId: l.itemId, mention: null, candidates: [], quantity: formatQty(l.ordered), unitSaid: null, unit: l.unitCode })),
      }}
    />
  );
}
