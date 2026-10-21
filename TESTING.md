# Testing

Everything runs by itself: before every push, on GitHub for every push, and every night.

| Layer | What it checks | Where | Command |
|---|---|---|---|
| Types + lint | Code mistakes before anything runs | push hook, CI | `npm run typecheck`, `npm run lint` |
| Unit / integration (`tests/`) | Every rule of orders, dispatches, stock, firms, import, reports, login, against a real Postgres (in-memory PGlite) | push hook, CI | `npm test` |
| Random histories (`tests/properties.test.ts`) | Thousands of made-up sequences of real actions across two firms sharing a godown; after every step: in stock, owed, free, low, pending, reports and FIFO all still add up; refused actions change nothing; retries never double-save | push hook (12), CI (25), nightly (300) | `npm run test:deep` |
| Browser (`e2e/`) | A production build on a phone-sized screen: every screen × owner/staff/viewer × English/Hindi (no crash, nothing wider than the phone, no NaN/undefined, right role access); real work through the screens with the numbers checked; offline saving; login | CI, nightly | `npm run test:e2e` |
| Safari engine | The same screens in WebKit, as on the iPhone | CI, nightly | `npm run test:e2e:safari` |
| API robustness (`e2e/api.spec.ts`) | No login, wrong role, wrong firm, garbage and random (fuzzed) bodies: always a clear 4xx, never a server error, nothing saved | CI (150 fuzz), nightly (2000) | part of `test:e2e` |
| Accessibility (`e2e/accessibility.spec.ts`) | Every main screen: buttons and fields have names, nothing hidden is focusable. Low-contrast text is listed in the run summary (not failing yet; `A11Y_STRICT=1` makes it fail) | CI, nightly | part of `test:e2e` |
| Live site (`smoke/`) | Read-only: up, fast, locked, headers, PWA files. Never logs in | after every deploy, nightly | `npm run test:live-smoke` |
| Test strength (mutation) | Plants thousands of small bugs in the calculation code; the score is how many the tests catch | weekly | `npm run test:mutation` |

## GitHub Actions (`.github/workflows/`)

| Workflow | When | What |
|---|---|---|
| CI | every push and pull request | types, lint, all tests with coverage (table in the run summary); migrations applied to empty Postgres 15 and 17, twice, and schema drift check; browser tests in Chrome and Safari; npm audit and secret scan; dependency review on pull requests |
| After deploy | each time Vercel puts a version live | read-only check of the live site |
| Uptime | every hour | live site answering; opens an issue while it is down |
| Nightly | 3 am India | 300 random histories on Node 22 and 24; every browser test twice (flaky hunt); 2000 fuzzed requests; live check |
| CodeQL | pushes, pull requests, weekly | GitHub's security scanner (Security tab → Code scanning) |
| Test strength | Sundays | mutation score per file, missed bugs listed in the run summary |
| Dependabot | Mondays | pull requests updating libraries; CI runs on each before you merge |

Scheduled checks open a GitHub issue labelled `automated-check` when they fail (GitHub emails you)
and close it themselves when they pass again. Every workflow can also be started by hand:
Actions tab → pick it → Run workflow.

`npm run check` = types + lint + tests (what the push hook runs). `npm run check:all` adds the browser tests.

## Browser tests: one-time setup on this Mac

```sh
createdb godown_e2e                 # the tests wipe and refill this database only
npx playwright install chromium webkit
```

They never read `.env` files and refuse any database that isn't on this machine.
To watch them click through: `npm run test:e2e -- --ui`. After a failure:
`npx playwright show-report` shows a screenshot and a step-by-step trace.

## When a random-history test fails

It prints the history that broke, the step, and a seed. Replay exactly that run with
`FC_SEED=<seed> FC_PATH=<path> npx vitest run tests/properties.test.ts`; add
`FC_SHRINK=1` to cut it down to the shortest history that still breaks.

## Push hook

Installed with `npm run hooks:install` (once per clone). Skip it once in an emergency with
`git push --no-verify`.
