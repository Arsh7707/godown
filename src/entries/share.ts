/**
 * The one-line summary shown after saving, with a WhatsApp share button.
 * Plain text, built from saved data (not AI), in the user's UI language.
 */
import { formatQty } from "@/lib/qty";
import type { Lang } from "@/i18n/messages";

export interface ShareLine {
  itemName: string;
  unit: string;
  /** This entry's quantity (centi). */
  quantity: number;
  /** Party's total balance for this item after saving (centi). */
  balance: number;
}

export function shareText(lang: Lang, kind: "order" | "dispatch", partyName: string, lines: ShareLine[]): string {
  const q = (c: number, unit: string) => `${formatQty(c)} ${unit}`;
  const parts = lines.map((l) => {
    if (kind === "dispatch") {
      return lang === "en"
        ? `${l.itemName} ${q(l.quantity, l.unit)} sent, ${q(l.balance, l.unit)} balance`
        : `${l.itemName} ${q(l.quantity, l.unit)} भेजा, ${q(l.balance, l.unit)} बाकी`;
    }
    return lang === "en"
      ? `${l.itemName} ${q(l.quantity, l.unit)} ordered, ${q(l.balance, l.unit)} pending`
      : `${l.itemName} ${q(l.quantity, l.unit)} का ऑर्डर, ${q(l.balance, l.unit)} बाकी`;
  });
  return `${partyName}: ${parts.join("; ")}`;
}

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export interface StockShareLine {
  itemName: string;
  unit: string;
  change: number;
  after: number;
}

/** "Goods in: Crown +24 pcs (now 48)" / "Stock count: Crown 40 pcs (−5)". */
export function stockShareText(lang: Lang, kind: "receipt" | "count" | "adjustment", lines: StockShareLine[]): string {
  const sign = (c: number) => (c > 0 ? `+${formatQty(c)}` : c < 0 ? `−${formatQty(-c)}` : "0");
  const head = { receipt: lang === "en" ? "Goods in" : "माल आया", count: lang === "en" ? "Stock count" : "स्टॉक गिनती", adjustment: lang === "en" ? "Stock adjusted" : "स्टॉक सुधार" }[kind];
  const now = lang === "en" ? "now" : "अब";
  return `${head}: ${lines
    .map((l) => (kind === "count" ? `${l.itemName} ${formatQty(l.after)} ${l.unit} (${sign(l.change)})` : `${l.itemName} ${sign(l.change)} ${l.unit} (${now} ${formatQty(l.after)})`))
    .join("; ")}`;
}
