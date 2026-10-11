import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { partiesForManage, partyUsed } from "@/masters/manage";
import { AppHeader } from "@/components/app-header";
import { ClientEditor } from "./client-editor";

export default async function ClientPage({ params }: PageProps<"/manage/clients/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const p = (await partiesForManage(db, ctxFor(user))).find((x) => x.id === id);
  if (!p) notFound();
  const used = await partyUsed(db, user.companyId, id);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/manage/clients" title={p.name} />
      <ClientEditor lang={user.language} party={p} canDelete={!used} />
    </>
  );
}
