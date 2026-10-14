import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { messages } from "@/i18n/messages";
import { todayIST } from "@/lib/dates";
import { AppHeader } from "@/components/app-header";
import { ImportView } from "./import-view";

export default async function ImportPage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const t = messages(user.language);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.imp.title} />
      <ImportView lang={user.language} today={todayIST()} shared={user.stockId !== user.companyId} />
    </>
  );
}
