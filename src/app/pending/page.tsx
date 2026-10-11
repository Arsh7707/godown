import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { pendingOverview } from "@/ledger/queries";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { PendingView } from "./pending-view";

export default async function PendingPage() {
  const user = await requireUser();
  const t = messages(user.language);
  const data = await pendingOverview(db, ctxFor(user));
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.p.title} />
      <PendingView lang={user.language} parties={data.parties} items={data.items} canDispatch={user.role !== "viewer"} />
    </>
  );
}
