import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { companyProfile } from "@/masters/profiles";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { CompanyEditor } from "./company-editor";

export default async function CompanyPage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const t = messages(user.language);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/manage" title={t.m.company} />
      <CompanyEditor lang={user.language} company={await companyProfile(db, ctxFor(user))} />
    </>
  );
}
