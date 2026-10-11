import { db } from "@/db/client";
import { ctxFor, requireUser } from "@/auth/session";
import { stockOverview } from "@/stock/service";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { LiveRefresh } from "@/components/live-refresh";
import { StockView } from "./stock-view";

export default async function StockPage() {
  const user = await requireUser();
  const t = messages(user.language);
  const rows = await stockOverview(db, ctxFor(user));
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.s.title} />
      <LiveRefresh />
      <StockView lang={user.language} rows={rows} canEnter={user.role !== "viewer"} isOwner={user.role === "owner"} />
    </>
  );
}
