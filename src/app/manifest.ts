import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Order Book",
    short_name: "Order Book",
    description: "Orders, dispatches and pending balances",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f5f2",
    theme_color: "#1f4e79",
    lang: "hi",
    // Android: shows Order Book in WhatsApp's Share menu for voice notes, photos and text.
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "files", accept: ["audio/*", "image/*", ".opus", ".ogg", ".m4a"] }] },
    },
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New Order / नया ऑर्डर", url: "/order/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Dispatch / माल भेजा", url: "/dispatch/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Pending / बाकी माल", url: "/pending", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
