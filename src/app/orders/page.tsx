import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { orderList } from "@/ledger/queries";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { LiveRefresh } from "@/components/live-refresh";
import { OrdersView } from "./orders-view";

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const user = await requireUser();
  const t = messages(user.language);
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const orders = await orderList(db, ctxFor(user));
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} title={t.ui.orders.title} />
      <LiveRefresh seconds={30} />
      <OrdersView lang={user.language} orders={orders} canEnter={user.role !== "viewer"} itemId={one(sp.item)} />
    </>
  );
}
