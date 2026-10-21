import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { itemsForManage, itemUsed } from "@/masters/manage";
import { formatQty } from "@/lib/qty";
import { AppHeader } from "@/components/app-header";
import { ItemEditor } from "./item-editor";

export default async function ItemPage({ params }: PageProps<"/manage/items/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const all = await itemsForManage(db, ctxFor(user));
  const it = all.find((x) => x.id === id);
  if (!it) notFound();
  const used = await itemUsed(db, user.stockId, id);
  const siblings = all.filter((x) => x.product === it.product).length;
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/manage/items" title={it.name} />
      <ItemEditor lang={user.language} item={{ ...it, lowStockLevel: formatQty(it.lowStockLevel) }} used={used} siblings={siblings} />
    </>
  );
}
