import { currentUser } from "@/auth/session";
import { messages } from "@/i18n/messages";
import { EmptyState } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";

/** A link to something that doesn't exist (deleted, mistyped, other firm): say so, offer the way home. */
export default async function NotFound() {
  const user = await currentUser();
  const t = messages(user?.language);
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[calc(var(--tabbar-space)+2rem)]">
      <EmptyState
        icon="question"
        title={t.err.NOT_FOUND}
        action={
          <ButtonLink href="/" variant="primary" size="lg" block icon="home">
            {t.e.home}
          </ButtonLink>
        }
      />
    </main>
  );
}
