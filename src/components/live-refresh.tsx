"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keeps a server-rendered screen current: refresh every few seconds and when the app comes back into view. */
export function LiveRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const go = () => document.visibilityState === "visible" && router.refresh();
    const timer = setInterval(go, seconds * 1000);
    document.addEventListener("visibilitychange", go);
    window.addEventListener("online", go);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", go);
      window.removeEventListener("online", go);
    };
  }, [router, seconds]);
  return null;
}
