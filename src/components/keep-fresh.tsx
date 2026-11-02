"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getJson, SAVED_EVENT } from "@/client/api";

/**
 * Keeps every screen current without throwing away the pages already opened
 * (they show again instantly). Every few seconds, when the app comes back into
 * view and right after a save, it asks the server whether anything was saved;
 * only then does it reload, which also makes the other screens fetch the new
 * numbers when next opened.
 *
 * `mark` comes from the server with each full render, so a reload brings the
 * new mark and the next check is quiet.
 */
export function KeepFresh({ mark, seconds = 15 }: { mark: string; seconds?: number }) {
  const router = useRouter();
  const known = useRef(mark);
  useEffect(() => {
    known.current = mark;
  }, [mark]);

  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await getJson<{ mark: string }>("/api/changes");
        if (r.ok && r.mark !== known.current) {
          known.current = r.mark;
          router.refresh();
        }
      } catch {
        // Offline: the next check catches up.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(check, seconds * 1000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    window.addEventListener(SAVED_EVENT, check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      window.removeEventListener(SAVED_EVENT, check);
    };
  }, [router, seconds]);
  return null;
}
