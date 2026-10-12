import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { teamList } from "@/masters/profiles";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { TeamEditor } from "./team-editor";

export default async function TeamPage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const t = messages(user.language);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/manage" title={t.m.team} />
      <TeamEditor lang={user.language} me={user.userId} team={await teamList(db, ctxFor(user))} />
    </>
  );
}
