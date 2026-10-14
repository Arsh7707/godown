import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { unmatchedOverview } from "@/ledger/unmatched";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { UnmatchedView } from "./unmatched-view";

export default async function UnmatchedPage() {
  const user = await requireUser();
  const t = messages(user.language);
  const data = await unmatchedOverview(db, ctxFor(user));
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.u.title} />
      <UnmatchedView lang={user.language} open={data.open} dismissed={data.dismissed} role={user.role} />
    </>
  );
}
