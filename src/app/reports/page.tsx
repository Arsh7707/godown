import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { messages } from "@/i18n/messages";
import { todayIST } from "@/lib/dates";
import { AppHeader } from "@/components/app-header";
import { ReportsView } from "./reports-view";

export default async function ReportsPage() {
  const user = await requireUser();
  if (user.role === "staff") redirect("/");
  const t = messages(user.language);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.r.title} />
      <ReportsView lang={user.language} today={todayIST()} firm={user.companyName} />
    </>
  );
}
