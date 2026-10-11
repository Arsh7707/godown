import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { messages } from "@/i18n/messages";
import { AppHeader } from "@/components/app-header";
import { NewProductForm } from "./new-product-form";

export default async function NewProductPage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/stock");
  const t = messages(user.language);
  return (
    <>
      <AppHeader companyName={user.companyName} userName={user.name} lang={user.language} back="/stock" title={t.s.newProduct} />
      <NewProductForm lang={user.language} />
    </>
  );
}
