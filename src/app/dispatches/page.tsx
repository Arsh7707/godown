import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { dispatchList } from "@/ledger/queries";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { DispatchedView } from "./dispatched-view";

export default async function DispatchedPage({ searchParams }: PageProps<"/dispatches">) {
  const user = await requireUser();
  const t = messages(user.language);
  const { all } = await searchParams;
  const list = await dispatchList(db, ctxFor(user), { includeCancelled: all === "1", limit: 300 });
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.d.title} />
      <DispatchedView lang={user.language} list={list} showingCancelled={all === "1"} />
    </>
  );
}
