import { db } from "@/db/client";
import { requireUser } from "@/auth/session";
import { myFirms } from "@/masters/firms";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { FirmsView } from "./firms-view";

export default async function FirmsPage() {
  const user = await requireUser();
  const t = messages(user.language);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.f.title} />
      <FirmsView lang={user.language} firms={await myFirms(db, user)} canAdd={user.role === "owner"} currentName={user.companyName} />
    </>
  );
}
