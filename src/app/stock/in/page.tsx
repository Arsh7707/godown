import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { todayIST } from "@/lib/dates";
import { EntryScreen } from "@/components/entry/entry-screen";

/** Goods in (?mode=receipt) or a stock count (?mode=count), by photo, voice, typing or form. */
export default async function StockInPage({ searchParams }: PageProps<"/stock/in">) {
  const user = await requireUser();
  if (user.role === "viewer") redirect("/stock");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const kind = one(sp.mode) === "count" ? "count" : "receipt";
  return <EntryScreen kind={kind} lang={user.language} today={todayIST()} resume={one(sp.resume)} fix={one(sp.fix)} />;
}
