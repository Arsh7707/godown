/**
 * What the model returns. Kept flat and fully required (nullable instead of
 * optional) so it works with structured outputs.
 *
 * One input (slip, voice note, message) can hold entries for several
 * parties; each party is one entry, with all of that party's items as lines.
 */
import { z } from "zod";

export const NameMention = z.object({
  as_written: z.string().describe("Exactly as written or spoken, original script"),
  latin: z.string().describe("Latin-script transliteration"),
  catalog_guess: z.string().nullable().describe("Exact catalog name if it clearly corresponds to one, else null"),
});

const DateMention = z.object({
  iso: z.string().nullable().describe("YYYY-MM-DD, or null if not stated / not resolvable"),
  as_written: z.string().nullable(),
});

export const Entry = z.object({
  party: NameMention.nullable(),
  lines: z.array(
    z.object({
      item: NameMention,
      quantity: z.number().nullable(),
      quantity_as_written: z.string().nullable(),
      unit: z.string().nullable().describe("Unit in English (pcs, meter, nag, dabba, bora, ...), null if none"),
    }),
  ),
  entry_date: DateMention,
  promised_date: DateMention,
  taken_by: z.string().nullable(),
  transport: z.string().nullable(),
  lr_number: z.string().nullable(),
  notes: z.string().nullable().describe("Other useful details for staff: rate, destination, 'transport details later'. Short, in the input's language"),
  summary: z.string().describe("One short line about this party's entry, in the input's language and script"),
});

export const ModelOutput = z.object({
  is_relevant: z.boolean().describe("False if the input contains no order/dispatch at all"),
  language: z.enum(["hi", "hinglish", "en"]),
  entries: z.array(Entry).describe("One per party, in the order they appear"),
  unreadable: z.array(z.string()).describe("Only words or numbers that could not be read or heard clearly"),
  summary: z.string().describe("One short line for the whole input, in its language and script"),
  summary_en: z
    .string()
    .describe("One or two short plain-English sentences covering everything in the input: each party, items with quantities and units, dates, transport, and any instructions"),
});

export type Entry = z.infer<typeof Entry>;
export type ModelOutput = z.infer<typeof ModelOutput>;
export type EntryKind = "order" | "dispatch" | "stock";
