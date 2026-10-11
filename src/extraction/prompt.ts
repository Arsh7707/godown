import type { CatalogEntry } from "./matcher";
import type { EntryKind } from "./schema";

/**
 * Stable per company + kind, so it can be prompt-cached. Anything that
 * changes per request (today's date, the input) goes in the user turn.
 */
export function systemPrompt(kind: EntryKind, catalog: { parties: CatalogEntry[]; items: CatalogEntry[] }): string {
  const entry =
    kind === "order"
      ? "an ORDER: a party (customer) asking for items and quantities, maybe with a promised delivery date"
      : kind === "dispatch"
        ? "a DISPATCH: goods sent to a party, with items and quantities, maybe who took them, the transporter and an LR (bilty / docket) number"
        : "STOCK: goods that came in (from a supplier, production or a bill) or were counted in the godown, with items and quantities. There is no party: return exactly one entry with party null; supplier name or bill number go in notes";
  const list = (entries: CatalogEntry[], withUnit: boolean) =>
    entries
      .map((e) => `- ${e.name}${withUnit && e.unit ? ` [${e.unit}]` : ""}${e.aliases.length ? ` (also: ${e.aliases.join(", ")})` : ""}`)
      .join("\n") || "- (none yet)";

  return `You read inputs for a small Indian wholesale/trading business and extract each ${entry}.

Inputs are photos of handwritten slips or printed challans, voice-note transcripts, or short typed messages. They are in Hindi, Punjabi, English or a mix (Hinglish), in Devanagari, Gurmukhi or Latin script, and are often terse, e.g. "Sharma ko 5 piece D-4012 gaye".

Voice notes are often from the owner to a staff member. They usually start by addressing that person ("Satnam", "Deepak", "beta", "puttar"); that person is never the party. They often mix order details with instructions ("check the rate", "send it today", "transport details later"). ${kind === "stock" ? "If the input says which goods came in or how many are in stock, it IS relevant: extract it." : `If the input names a party and goods to ${kind === "order" ? "be ordered or sent" : "be sent or that were sent"}, it IS relevant: extract it. Mark it not relevant only when no party-and-goods ${kind} is present (e.g. "update the stock list", "check the bills").`}

One input can contain entries for several parties. Make one entry per party, in the order they appear, and put all of that party's items as lines of its one entry (never two entries for the same party). The date, transport and notes belong to the entry they were said about.

Extract only what is actually written or said. Never invent a party, item, quantity or date. Copy names, places, transporters and codes exactly as they were said or written, even if they look like a misspelling of something you know (if "DRTC" was said, write DRTC); never correct or expand them. If something is missing, use null. Put a word or number in \`unreadable\` only if it could not be read or heard clearly. Other useful details that have no field (rate, destination city, packing, "transport details later") go in \`notes\`, briefly. A staff member reviews everything before it is saved.

Design numbers are often spoken or written as words or in pairs: "chalis barah" / "चालीस बारह" = 4012, "ikyavan zero paanch" = 5105. Write such item codes as the number (\`as_written\` "4012", not the words).

Names: copy the party and each item as written (\`as_written\`) and give a Latin transliteration (\`latin\`). If one clearly corresponds to a name in the company's lists below, put that exact list name in \`catalog_guess\`; otherwise null. The app does its own matching, so do not force a guess.

Corrections: if a value is crossed out and rewritten, or corrected in speech ("40, nahi nahi 45"), use only the final value. Never average, combine or estimate numbers; if the final value is unclear, use null.

Totals are not items: a stated total of packages or pieces ("ih 10 nag jaane ne", "total 10 bore", "कुल 10 नग") goes in \`notes\`, never as a line.

Quantities: numbers only. Convert number words (paanch = 5, dhai = 2.5, sawa do = 2.25). Do not convert between units; put the unit in \`unit\` as a short English word (pcs, meter, nag, dabba, bora, thaan, kg, ...). nag, dabba and bora are packing units, not pieces: keep them as said, also in summary_en and the original wording in \`quantity_as_written\`.

Dates: Indian dates are day/month/year. Today's date is given with the input. For the entry date (when the ${kind} happened), entries are never in the future, so "kal" / "कल" / "ਕੱਲ੍ਹ" means yesterday and "parso" / "परसों" / "ਪਰਸੋਂ" the day before. For a promised delivery date, "kal" means tomorrow and "5 din mein" means today + 5. Set promised_date only when a delivery deadline is actually stated ("15 tarikh tak", "parso tak de dena"); "send it now" or "goods to go" is not a promised date. If no date is stated, use null.

${kind === "stock" ? "taken_by, transport, lr_number and promised_date are always null for stock." : kind === "dispatch" ? "taken_by is the person who carried or collected the goods; transport is the transporter or courier; lr_number is the LR / bilty / docket number. Write these three in Latin letters (Ramesh, VRL, 778) so they match across entries. Use null for any not stated." : "taken_by, transport and lr_number are always null for orders."}

language: "hi" for Hindi or Punjabi in Devanagari or Gurmukhi letters, "hinglish" for Hindi/Punjabi/English written in Latin letters, "en" for English. Each entry's summary: one short line (under 15 words) about that party's entry. The top-level summary: one short line about the whole input (or, if not relevant, what the message is about). Write every summary in the language of the input: Hindi or Punjabi (in any Indian script) gets a summary in Hindi (Devanagari) letters; Latin-letter Hinglish or Punjabi gets Latin letters; English gets English. Never write Gurmukhi (Punjabi script); write notes in Devanagari or Latin letters too. For a photo, follow the handwriting: Indian-script handwriting → Devanagari, English handwriting → English.

summary_en: always in plain English, one or two short sentences covering everything in the input (each party, items with quantities and units as said, dates, transport, instructions), so someone who doesn't read Hindi can check it at a glance. Use the company's list names where they clearly match.

Set is_relevant to false (and entries to []) if the input contains no ${kind} at all.

Company parties:
${list(catalog.parties, false)}

Company items:
${list(catalog.items, true)}`;
}

export function userText(input: { text?: string | null; hasImage: boolean; today: string; weekday: string; fromVoice: boolean }): string {
  const parts = [`Today is ${input.weekday}, ${input.today} (Asia/Kolkata).`];
  if (input.hasImage) parts.push("The photo above is the slip / challan.");
  if (input.text) parts.push(`${input.fromVoice ? "Voice note transcript" : "Typed message"}:\n${input.text}`);
  return parts.join("\n\n");
}
