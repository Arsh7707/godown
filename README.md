# Order Book (godown)

Mobile-first order, dispatch and stock tracker for small Indian manufacturers
and wholesalers. Orders and dispatches can be entered by photo, voice note
(Hindi / Punjabi / Hinglish / English), typed message or form; nothing the AI
reads is saved until a person confirms it.

## Stack

Next.js (App Router) PWA · TypeScript · Postgres + Drizzle · Tailwind ·
Claude API (reading slips, messages, voice transcripts) · Sarvam AI
(speech-to-text) · Supabase (database + private file storage) · Vercel.

## Core rules

- Orders, dispatches and stock are append-only; balances and stock are always
  computed, never stored. Corrections are new versions.
- Dispatches count against the party's oldest open order for the same item and
  unit (FIFO). Units (pcs, nag, dabba, bora, thaan) are saved as said, never converted.
- Every table carries `company_id` (multi-company from day one). All dates are Asia/Kolkata.

## Run locally

```bash
cp .env.example .env.local      # fill in DATABASE_URL, keys, SESSION_SECRET
npm install
npx drizzle-kit migrate         # create tables
npm run seed -- seed/company.example.json
npm run dev                     # http://localhost:3000
```

## Checks

```bash
npm test             # unit + database tests (in-memory Postgres)
npm run test:live    # real Claude calls (needs keys)
npm run eval:fixtures  # read the samples in fixtures/ and score them
```
