import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { itemsForManage } from "@/masters/manage";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { ItemList } from "./item-list";

export default async function ItemsPage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const t = messages(user.language);
  const list = await itemsForManage(db, ctxFor(user));
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/manage" title={t.m.items} />
      <ItemList lang={user.language} list={list} />
    </>
  );
}
