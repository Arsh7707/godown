import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  const lang = (await cookies()).get("ob_lang")?.value === "en" ? "en" : "hi";
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <LoginForm
        initialLang={lang}
        needsAccessCode={process.env.OTP_DEV_MODE === "true" && !!process.env.TEST_ACCESS_CODE}
      />
    </main>
  );
}
