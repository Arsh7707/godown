"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Icon } from "./ui/icons";
import type { Messages } from "@/i18n/messages";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** "Install app" button on Android/Chrome; a short how-to on iPhone. Hidden once installed. */
export function InstallPrompt({ t }: { t: Messages }) {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (standalone) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const t0 = setTimeout(() => {
      if (isIos) {
        setIos(true);
        setHidden(false);
      }
    }, 0);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      clearTimeout(t0);
    };
  }, []);

  if (hidden) return null;
  return (
    <div className="flex items-center gap-3 rounded-card bg-brand-soft p-3">
      <Image src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-lg" />
      <p className="flex-1 text-sm text-ink-muted">{ios ? t.installIos : t.installHint}</p>
      {evt && (
        <button
          className="min-h-12 rounded-control bg-brand px-4 font-semibold text-ink-inverse"
          onClick={async () => {
            await evt.prompt();
            await evt.userChoice;
            setHidden(true);
          }}
        >
          {t.install}
        </button>
      )}
      <button className="flex size-12 shrink-0 items-center justify-center rounded-control text-ink-subtle" aria-label={t.ui.close} onClick={() => setHidden(true)}>
        <Icon name="close" size={22} />
      </button>
    </div>
  );
}
