# Extraction fixtures

Real order slips, challans and voice notes used to measure the extraction
pipeline. Run with `npm run eval:fixtures` (needs ANTHROPIC_API_KEY,
ANTHROPIC_MODEL and, for voice notes, SARVAM_API_KEY in `.env.local`).

Customer files here are git-ignored by default (see `.gitignore`) so real
business data is not committed by accident.

## Layout

```
fixtures/
  catalog.json                     the company's parties and items (falls back to catalog.example.json)
  order-sharma-slip.jpg            one case = one input file…
  order-sharma-slip.expected.json  …plus, optionally, the correct answer
  dispatch-gupta-voice.ogg
  dispatch-gupta-voice.expected.json
  order-typed.txt                  typed text cases are .txt
```

- Images: .jpg .jpeg .png .webp
- Voice: .ogg .opus .m4a .mp3 .wav .webm .aac .amr
- Text: .txt
- File names start with `order-` or `dispatch-` (or set `"kind"` in the expected file).

## catalog.json

```json
{
  "parties": [{ "name": "Sharma Textiles", "aliases": ["Sharma", "शर्मा"] }],
  "items": [{ "name": "D-4012", "unit": "pcs", "aliases": ["4012"] }]
}
```

## <case>.expected.json

Every field is optional; only the fields present are graded. Names must be
the catalog names. Dates are YYYY-MM-DD.

```json
{
  "kind": "dispatch",
  "today": "2026-10-08",
  "party": "Sharma Textiles",
  "lines": [{ "item": "D-4012", "quantity": "5" }],
  "entryDate": "2026-10-07",
  "promisedDate": null,
  "takenBy": "Ramesh",
  "transport": "VRL",
  "lrNumber": "778"
}
```

For an input with several parties, list them under `entries` (one per party,
all of that party's items together). Use `"entries": []` for a message that
is not an order or dispatch at all:

```json
{
  "kind": "order",
  "entries": [
    { "party": "Sharma Textiles", "lines": [{ "item": "D-4012", "quantity": "20" }] },
    { "party": "Gupta Traders", "lines": [{ "item": "Cotton Poplin", "quantity": "50" }] }
  ]
}
```

`today` pins "today" for that case so relative dates ("kal") grade the same
on any day; it defaults to the real date.
