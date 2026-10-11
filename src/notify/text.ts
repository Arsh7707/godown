/** Wording of the push notifications themselves (server only; UI text lives in i18n/messages). */
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
};

export const pushText = (lang: "hi" | "en") => (lang === "en" ? en : hi);
