import { ListRow, RowGroup } from "@/components/ui/card";
import { Page } from "@/components/ui/screen";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";

export default async function ManagePage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  const t = messages(user.language);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.m.title} />
      <Page>
        <RowGroup>
          <ListRow href="/manage/clients" icon="users" title={t.m.clients} subtitle={t.m.clientsHint} />
          <ListRow href="/manage/items" icon="tag" title={t.m.items} subtitle={t.m.itemsHint} />
          <ListRow href="/manage/team" icon="user" title={t.m.team} subtitle={t.m.teamHint} />
          <ListRow href="/manage/company" icon="building" title={t.m.company} subtitle={t.m.companyHint} />
        </RowGroup>
      </Page>
    </>
  );
}
