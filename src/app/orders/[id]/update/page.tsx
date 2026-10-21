import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { orderDetail } from "@/ledger/queries";
import { LedgerError } from "@/lib/errors";
import { formatQty } from "@/lib/qty";
import { todayIST } from "@/lib/dates";
import { UpdateScreen } from "./update-screen";

export default async function UpdateOrderPage({ params }: PageProps<"/orders/[id]/update">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  const o = await orderDetail(db, ctxFor(user), id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  if (!o.canChange) redirect(`/orders/${id}`);
  return (
    <UpdateScreen
      lang={user.language}
      today={todayIST()}
      orderId={id}
      rev={o.rev}
      partyId={o.party.id}
      partyName={o.party.name}
      orderDate={o.orderDate}
      notes={o.notes}
      lines={o.lines.map((l) => `${l.itemName} ${formatQty(l.ordered)} ${l.unit}`)}
    />
  );
}
