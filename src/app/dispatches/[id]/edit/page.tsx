import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { isUuid } from "@/lib/ids";
import { ctxFor, requireUser } from "@/auth/session";
import { dispatchForEdit } from "@/ledger/queries";
import { LedgerError } from "@/lib/errors";
import { formatQty, toCenti } from "@/lib/qty";
import { todayIST } from "@/lib/dates";
import { messages } from "@/i18n/messages";
import { EditScreen } from "@/components/entry/edit-screen";

export default async function EditDispatchPage({ params, searchParams }: PageProps<"/dispatches/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { back } = await searchParams;
  const user = await requireUser();
  const t = messages(user.language);
  const d = await dispatchForEdit(db, ctxFor(user), id).catch((e) => {
    if (e instanceof LedgerError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const backHref = typeof back === "string" && back.startsWith("/") ? back : "/pending";
  if (!d.canChange) redirect(backHref);
  return (
    <EditScreen
      kind="dispatch"
      lang={user.language}
      today={todayIST()}
      title={`${t.e.edit}: ${t.dispatch}`}
      backHref={backHref}
      mode={{ type: "correctDispatch", dispatchId: id, baseRev: d.rev }}
      initial={{
        partyId: d.partyId,
        partyMention: null,
        partyCandidates: [],
        date: d.dispatchDate,
        promisedDate: "",
        takenBy: d.takenBy ?? "",
        transport: d.transport ?? "",
        lrNumber: d.lrNumber ?? "",
        notes: d.notes ?? "",
        lines: d.lines.map((l, i) => ({ key: `d${i}`, itemId: l.itemId, mention: null, candidates: [], quantity: formatQty(toCenti(l.quantity)), unitSaid: null, unit: l.unit })),
      }}
    />
  );
}
