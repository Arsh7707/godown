import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { activityPeople } from "@/ledger/activity";
import { messages } from "@/i18n/messages";
import { todayIST } from "@/lib/dates";
import { AppHeader } from "@/components/app-header";
import { ActivityView } from "./activity-view";

export default async function ActivityPage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const t = messages(user.language);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.a.title} />
      <ActivityView lang={user.language} people={await activityPeople(db, ctxFor(user))} today={todayIST()} />
    </>
  );
}
