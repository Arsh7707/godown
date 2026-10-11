/**
 * Updating an existing order from a voice note or message
 * ("20 ki jagah 25 kar do, aur 5 Vistara add karo", "baaki cancel kar do").
 *
 * The model returns the order's complete lines after the change; matching
 * against the company's items stays deterministic (see matcher.ts). Nothing
 * is saved here: the result pre-fills the edit form for the user to check.
 */
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { isValidDate } from "@/lib/dates";
import { storedUnit } from "@/lib/units";
import { displayScript } from "@/lib/script";
import { formatQty, toPositiveCenti } from "@/lib/qty";
import { matchMention, type Candidate } from "./matcher";
import { NameMention } from "./schema";
import { ExtractionError, type Catalog } from "./types";

export const ChangeOutput = z.object({
  understood: z.boolean().describe("False if it is not clear what change is wanted"),
  cancel_remaining: z.boolean().describe("True if the rest of the order should be cancelled / is no longer wanted"),
  lines: z
    .array(
      z.object({
        item: NameMention,
        quantity: z.number().nullable().describe("New total ordered quantity for this item"),
        unit: z.string().nullable().describe("Unit as said in English (pcs, nag, dabba, bora...) if a different unit was said for this item, else null"),
      }),
    )
    .describe("Every line of the order AFTER the change, including unchanged ones"),
  promised_date: z.object({ action: z.enum(["keep", "set", "clear"]), iso: z.string().nullable() }),
  note: z.string().nullable().describe("Extra detail worth noting on the order, if any"),
  unreadable: z.array(z.string()),
  summary: z.string().describe("One short line saying what changes, in the input's language and script"),
});
export type ChangeOutput = z.infer<typeof ChangeOutput>;

export interface CurrentOrder {
  partyName: string;
  orderDate: string;
  promisedDate: string | null;
  lines: { orderLineId: string; itemId: string; itemName: string; unit: string; unitCode?: string | null; ordered: number; sent: number }[];
}

export function changeSystemPrompt(catalog: Catalog): string {
  const items = catalog.items.map((i) => `- ${i.name} [${i.unit}]${i.aliases.length ? ` (also: ${i.aliases.join(", ")})` : ""}`).join("\n") || "- (none)";
  return `You update an existing ORDER for a small Indian wholesale/trading business from an instruction given by voice note or message, in Hindi, Punjabi, English or a mix, in any script.

You get the current order (items, ordered and already-sent quantities) and the instruction. Return the complete list of lines AFTER the change:
- Keep unchanged lines exactly as they are, using the item name exactly as shown in the current order.
- If a packing unit different from the item's unit is said ("2 dabba", "1 bora"), give that number and put the unit in \`unit\`; do not convert. Otherwise unit is null.
- Quantities are the new TOTAL ordered amount: "20 ki jagah 25" → 25; "5 aur" / "5 badha do" → current + 5; "5 kam kar do" → current − 5.
- A new item: add a line, item name as said (as_written) with a Latin transliteration, and catalog_guess if it clearly matches the item list below.
- "X hata do" / "X nahi chahiye": leave that line out.
- "baaki cancel", "ab nahi chahiye", "order band karo" (the rest is not wanted): set cancel_remaining true and keep the lines as they are.
- Promised date: "keep" unless the instruction changes it; "set" with YYYY-MM-DD (Indian dates are day/month; "kal" = tomorrow, "5 din mein" = today + 5); "clear" if they say there is no deadline now.
- If a value is corrected while speaking ("25, nahi 30"), use the final value. Never invent or estimate numbers.
- If it is not clear what change is wanted, set understood false.
The voice note may start by addressing a staff member ("Satnam", "beta"); ignore that.

summary: one short line (under 15 words) of what changes, in the language of the instruction: Hindi or Punjabi in Hindi (Devanagari) letters, Latin-letter Hinglish/Punjabi in Latin letters, English in English. Never use Gurmukhi script.

Company items:
${items}`;
}

export function changeUserText(order: CurrentOrder, instruction: string, today: string, fromVoice: boolean): string {
  const lines = order.lines.map((l) => `- ${l.itemName}: ordered ${formatQty(l.ordered)} ${l.unit}, already sent ${formatQty(l.sent)}`).join("\n");
  return `Today is ${today} (Asia/Kolkata).

Current order for ${order.partyName}, dated ${order.orderDate}${order.promisedDate ? `, promised by ${order.promisedDate}` : ""}:
${lines}

${fromVoice ? "Voice note transcript" : "Instruction"}:
${instruction}`;
}

export interface ProposedLine {
  orderLineId?: string;
  itemId: string | null;
  mention: string | null;
  candidates: Candidate[];
  quantity: string;
  unitSaid: string | null;
  saidQty: string | null;
  /** Unit to save as said: null = item's own unit. */
  unit: string | null;
}

export interface ChangeProposal {
  understood: boolean;
  cancelRemaining: boolean;
  lines: ProposedLine[];
  promisedDate: string | null;
  note: string | null;
  summary: string | null;
  sourceText: string;
  /** Item-by-item before → after, for the confirmation banner. */
  changes: { itemName: string; before: string | null; after: string | null }[];
}

/** Turns the model's answer into form lines, keeping existing order lines' identity. */
export function buildProposal(out: ChangeOutput, order: CurrentOrder, catalog: Catalog, sourceText: string): ChangeProposal {
  const byItem = new Map(order.lines.map((l) => [l.itemId, l]));
  const used = new Set<string>();
  const lines: ProposedLine[] = out.lines.map((l) => {
    // Existing lines are named exactly as in the order, so an exact name match finds them.
    const m = matchMention({ asWritten: l.item.as_written, latin: l.item.latin, catalogGuess: l.item.catalog_guess }, catalog.items);
    const itemId = m.status === "matched" ? m.id : null;
    const existing = itemId && !used.has(itemId) ? byItem.get(itemId) : undefined;
    if (existing) used.add(existing.itemId);
    let quantity = "";
    if (l.quantity !== null) {
      try {
        quantity = formatQty(toPositiveCenti(String(l.quantity)));
      } catch {
        quantity = "";
      }
    }
    const said = l.unit ?? null;
    const itemUnit = itemId ? catalog.items.find((i) => i.id === itemId)?.unit : undefined;
    // Saved as said (no conversion); an existing line keeps its unit unless another is said.
    const unit = itemUnit ? (storedUnit(said, itemUnit) ?? null) : null;
    return {
      orderLineId: existing?.orderLineId,
      itemId,
      mention: m.mention,
      candidates: m.candidates,
      quantity,
      unitSaid: said,
      saidQty: quantity || null,
      unit: said ? unit : (existing ? (order.lines.find((x) => x.orderLineId === existing.orderLineId)?.unitCode ?? null) : null),
    };
  });

  const promisedDate =
    out.promised_date.action === "set" && out.promised_date.iso && isValidDate(out.promised_date.iso)
      ? out.promised_date.iso
      : out.promised_date.action === "clear"
        ? null
        : order.promisedDate;

  const changes: ChangeProposal["changes"] = [];
  for (const cur of order.lines) {
    const after = lines.find((l) => l.orderLineId === cur.orderLineId);
    const before = `${formatQty(cur.ordered)} ${cur.unit}`;
    const afterText = after ? `${after.quantity || "?"} ${cur.unit}` : null;
    if (afterText !== before) changes.push({ itemName: cur.itemName, before, after: afterText });
  }
  for (const l of lines) {
    if (l.orderLineId) continue;
    const it = l.itemId ? catalog.items.find((i) => i.id === l.itemId) : undefined;
    changes.push({ itemName: it?.name ?? `“${l.mention ?? "?"}”`, before: null, after: `${l.quantity || "?"} ${it?.unit ?? ""}`.trim() });
  }
  if (promisedDate !== order.promisedDate) changes.push({ itemName: "📅", before: order.promisedDate, after: promisedDate });

  return {
    understood: out.understood,
    cancelRemaining: out.cancel_remaining,
    lines,
    promisedDate,
    note: out.note?.trim() ? displayScript(out.note.trim()) : null,
    summary: displayScript(out.summary.trim()) || null,
    sourceText,
    changes,
  };
}

export type AskModel = (schema: typeof ChangeOutput, system: string, content: Anthropic.ContentBlockParam[], signal: AbortSignal) => Promise<ChangeOutput>;

const unsure = (o: ChangeOutput) => !o.understood || o.unreadable.length > 0 || o.lines.some((l) => l.quantity === null);

/** Cheap model first; the stronger one if the cheap one is unsure or fails. */
export async function interpretChange(
  models: { simple: AskModel; complex: AskModel },
  input: { order: CurrentOrder; catalog: Catalog; instruction: string; today: string; fromVoice: boolean },
  signal: AbortSignal,
): Promise<ChangeProposal> {
  if (!input.instruction.trim()) throw new ExtractionError("empty_input", "Nothing to read");
  const system = changeSystemPrompt(input.catalog);
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: changeUserText(input.order, input.instruction, input.today, input.fromVoice) }];
  let out: ChangeOutput | null = null;
  try {
    out = await models.simple(ChangeOutput, system, content, signal);
  } catch (e) {
    if (e instanceof ExtractionError && (e.reason === "timeout" || e.reason === "not_configured")) throw e;
  }
  if (!out || unsure(out)) out = await models.complex(ChangeOutput, system, content, signal);
  return buildProposal(out, input.order, input.catalog, input.instruction);
}
