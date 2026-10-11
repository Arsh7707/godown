"use client";

import { useRouter } from "next/navigation";

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      className="w-full py-3 text-stone-500 underline-offset-4 hover:underline"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
