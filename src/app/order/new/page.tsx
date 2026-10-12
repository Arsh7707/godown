import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { pastDay, todayIST } from "@/lib/dates";
import { EntryScreen } from "@/components/entry/entry-screen";

export default async function NewOrderPage({ searchParams }: PageProps<"/order/new">) {
  const user = await requireUser();
  if (user.role === "viewer") redirect("/");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  return <EntryScreen kind="order" lang={user.language} today={todayIST()} day={pastDay(one(sp.date))} resume={one(sp.resume)} fix={one(sp.fix)} shared={one(sp.shared)} />;
}
