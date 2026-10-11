import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/service-worker";

export const metadata: Metadata = {
  title: "Order Book",
  description: "Orders, dispatches and pending balances for your business",
  applicationName: "Order Book",
  appleWebApp: { capable: true, title: "Order Book", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#1f4e79",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="hi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
