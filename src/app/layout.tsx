import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/service-worker";
import { currentUser } from "@/auth/session";

export const metadata: Metadata = {
  title: "Godown",
  description: "Orders, dispatches and pending balances for your business",
  applicationName: "Godown",
  appleWebApp: { capable: true, title: "Godown", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#1f4e79",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  return (
    <html lang="hi" className="h-full antialiased">
      <head>
        {/* The firm this screen belongs to: sent with every request so nothing lands in another firm after a switch. */}
        {user && <meta name="godown-firm" content={user.companyId} />}
        {user && <meta name="godown-firm-name" content={user.companyName} />}
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
