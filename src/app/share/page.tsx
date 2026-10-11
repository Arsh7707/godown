import { requireUser } from "@/auth/session";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { ShareChooser } from "./share-chooser";

/** Landing screen after sharing a voice note / photo / message from WhatsApp. */
export default async function SharePage({ searchParams }: PageProps<"/share">) {
  const user = await requireUser();
  const t = messages(user.language);
  const { id } = await searchParams;
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/" title={t.e.sharedTitle} />
      <ShareChooser lang={user.language} id={typeof id === "string" ? id : ""} canCreate={user.role !== "viewer"} />
    </>
  );
}
