import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/service-worker";
import { currentUser } from "@/auth/session";
import { db } from "@/db/client";
import { changeMark } from "@/ledger/changes";
import { KeepFresh } from "@/components/keep-fresh";
import { messages } from "@/i18n/messages";
import { TabBar } from "@/components/ui/tab-bar";
import { ToastProvider } from "@/components/ui/feedback";

/** Matches the top bar, so the phone's status bar and the app read as one surface. */
const CHROME = "#f4f3ef";

export const metadata: Metadata = {
  title: "Godown",
  description: "Orders, dispatches and pending balances for your business",
  applicationName: "Godown",
  appleWebApp: { capable: true, title: "Godown", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: CHROME,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  const t = user ? messages(user.language) : null;
  const mark = user ? await changeMark(db, user) : null;
  return (
    <html lang={user?.language === "en" ? "en" : "hi"} className="h-full antialiased">
      <head>
        {/* The firm this screen belongs to: sent with every request so nothing lands in another firm after a switch. */}
        {user && <meta name="godown-firm" content={user.companyId} />}
        {user && <meta name="godown-firm-name" content={user.companyName} />}
      </head>
      <body className="flex min-h-full flex-col">
        <ToastProvider>
          {children}
          {t && <TabBar labels={{ ...t.ui.tabs, nav: t.ui.nav }} />}
          {mark !== null && <KeepFresh mark={mark} />}
        </ToastProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
