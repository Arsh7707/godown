import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";

export default async function ManagePage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const t = messages(user.language);
  const tile = "block rounded-2xl bg-white px-6 py-6 shadow-sm active:bg-stone-50";
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.m.title} />
      <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-5">
        <Link href="/manage/clients" className={tile}>
          <span className="block text-2xl font-bold">👥 {t.m.clients}</span>
          <span className="block text-stone-500">{t.m.clientsHint}</span>
        </Link>
        <Link href="/manage/items" className={tile}>
          <span className="block text-2xl font-bold">🏷️ {t.m.items}</span>
          <span className="block text-stone-500">{t.m.itemsHint}</span>
        </Link>
      </main>
    </>
  );
}
