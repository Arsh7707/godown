import { requireUser } from "@/auth/session";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { InboxView } from "./inbox-view";

export default async function InboxPage() {
  const user = await requireUser();
  const t = messages(user.language);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.inbox.title} />
      <InboxView lang={user.language} />
    </>
  );
}
