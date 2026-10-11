import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { partiesForManage } from "@/masters/manage";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { ClientList } from "./client-list";

export default async function ClientsPage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const t = messages(user.language);
  const list = await partiesForManage(db, ctxFor(user));
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/manage" title={t.m.clients} />
      <ClientList lang={user.language} list={list} />
    </>
  );
}
