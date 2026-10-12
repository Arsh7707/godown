/** Wording of the push notifications themselves (server only; UI text lives in i18n/messages). */
export type StaffAction =
  | "order.create"
  | "order.edit"
  | "order.cancel"
  | "dispatch.create"
  | "dispatch.edit"
  | "dispatch.cancel"
  | "stock.receipt"
  | "stock.count"
  | "stock.adjustment"
  | "stock.undo"
  | "party.create"
  | "item.create";

const en = {
  overdueTitle: (n: number) => `${n} overdue ${n === 1 ? "order" : "orders"}`,
  days: (d: number) => `${d} ${d === 1 ? "day" : "days"}`,
  more: (n: number) => `+${n} more`,
  unmatched: (n: number) => `${n} ${n === 1 ? "dispatch" : "dispatches"} not matched to an order`,
  morningTitle: "Good morning · Godown",
  lowTitle: "Stock running low",
  freeLeft: "free",
  overTitle: "Sent more than stock",
  short: "short",
  sentBy: (party: string, who: string) => `to ${party} · by ${who}`,
  // staff activity (to owners)
  act: {
    "order.create": "New order",
    "order.edit": "Order changed",
    "order.cancel": "Order cancelled",
    "dispatch.create": "Dispatch",
    "dispatch.edit": "Dispatch changed",
    "dispatch.cancel": "Dispatch cancelled",
    "stock.receipt": "Goods in",
    "stock.count": "Stock count",
    "stock.adjustment": "Stock adjusted",
    "stock.undo": "Stock entry undone",
    "party.create": "New client",
    "item.create": "New item",
  } as Record<StaffAction, string>,
  // stock keeper
  stockTitle: "Maal add kiya?",
  stockBody: "No goods-in entered today. Tap to add what came in.",
};

const hi: typeof en = {
  overdueTitle: (n) => `${n} ऑर्डर लेट`,
  days: (d) => `${d} दिन`,
  more: (n) => `+${n} और`,
  unmatched: (n) => `${n} डिस्पैच किसी ऑर्डर से नहीं मिले`,
  morningTitle: "सुप्रभात · गोदाम",
  lowTitle: "स्टॉक कम है",
  freeLeft: "फ्री",
  overTitle: "स्टॉक से ज़्यादा भेजा",
  short: "कम",
  sentBy: (party, who) => `${party} को · ${who} ने भेजा`,
  act: {
    "order.create": "नया ऑर्डर",
    "order.edit": "ऑर्डर बदला",
    "order.cancel": "ऑर्डर रद्द",
    "dispatch.create": "डिस्पैच",
    "dispatch.edit": "डिस्पैच बदला",
    "dispatch.cancel": "डिस्पैच रद्द",
    "stock.receipt": "माल आया",
    "stock.count": "स्टॉक गिनती",
    "stock.adjustment": "स्टॉक बदला",
    "stock.undo": "स्टॉक एंट्री वापस",
    "party.create": "नई पार्टी",
    "item.create": "नया माल",
  },
  stockTitle: "माल ऐड किया?",
  stockBody: "आज माल आने की कोई एंट्री नहीं हुई। जो माल आया, यहाँ दबाकर जोड़ें।",
};

export const pushText = (lang: "hi" | "en") => (lang === "en" ? en : hi);
