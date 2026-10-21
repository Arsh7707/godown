/**
 * The server, hit directly the way a broken phone, a stale screen or someone
 * poking at it would: no login, the wrong role, the wrong firm, garbage and
 * random bodies, and invalid business input. It must always answer with a
 * clear 4xx and never a server error, and refused requests save nothing.
 */
import fc from "fast-check";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, stateFile, type Seed } from "./fixtures";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const tomorrow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 86_400_000));
const uid = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const order = (s: Seed, over: Record<string, unknown> = {}) => ({ entryCaptureId: uid(), inputMethod: "form", partyId: s.gupta, date: today(), lines: [{ itemId: s.probe, quantity: "2" }], ...over });

/** Every endpoint that needs a login, with a body that would be valid. */
const ENDPOINTS = (s: Seed): [string, string][] => [
  ["GET", "/api/activity"],
  ["GET", "/api/catalog"],
  ["POST", `/api/dispatches/${s.dispatchId}/cancel`],
  ["POST", `/api/dispatches/${s.dispatchId}/correct`],
  ["POST", "/api/dispatches/preview"],
  ["POST", "/api/dispatches"],
  ["POST", "/api/extract"],
  ["GET", "/api/firm"],
  ["GET", "/api/import"],
  ["POST", "/api/import"],
  ["POST", `/api/items/${s.d4012}/settings`],
  ["POST", "/api/items"],
  ["POST", "/api/manage"],
  ["POST", "/api/me/language"],
  ["POST", `/api/orders/${s.orderId}/cancel`],
  ["POST", `/api/orders/${s.orderId}/correct`],
  ["POST", `/api/orders/${s.orderId}/interpret`],
  ["POST", "/api/orders"],
  ["GET", `/api/parties/${s.sharma}/pending`],
  ["POST", "/api/parties"],
  ["POST", "/api/products"],
  ["GET", "/api/push/subscribe"],
  ["POST", "/api/push/subscribe"],
  ["POST", "/api/push/test"],
  ["GET", "/api/reports?from=2026-01-01&to=2026-12-31"],
  ["POST", "/api/stock/00000000-0000-0000-0000-000000000000/reverse"],
  ["POST", "/api/stock"],
  ["GET", "/api/unmatched"],
  ["POST", "/api/unmatched"],
  ["POST", "/api/uploads"],
];

const call = (r: APIRequestContext, method: string, url: string, data?: unknown, headers?: Record<string, string>) =>
  r.fetch(url, { method, data: method === "GET" ? undefined : data, headers, maxRedirects: 0, failOnStatusCode: false });

test("without a login every endpoint answers 401", async ({ playwright, seed }) => {
  const r = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  for (const [method, url] of ENDPOINTS(seed)) {
    const res = await call(r, method, url, {});
    expect(res.status(), `${method} ${url}`).toBe(401);
  }
  for (const url of ["/api/cron/digest", "/api/cron/stock-keeper"]) {
    expect((await call(r, "GET", url)).status(), `${url} without the secret`).toBe(401);
    expect((await call(r, "GET", url, undefined, { authorization: "Bearer wrong" })).status(), `${url} with a wrong secret`).toBe(401);
  }
  await r.dispose();
});

test.describe("as owner", () => {
  test.use({ storageState: stateFile("owner") });

  test("garbage bodies get a clear 4xx, never a server error", async ({ request, seed }) => {
    const junk: unknown[] = [undefined, "not json", "", [], {}, null, 0, { lines: "x" }, { partyId: "abc", date: "2026-13-45", lines: [{ itemId: "x", quantity: "-1" }] }, { baseRev: "1" }, { baseRev: 1e309 }, { action: "nope" }, { a: "x".repeat(200_000) }];
    for (const [method, url] of ENDPOINTS(seed)) {
      // push/test takes no body, and answers 503 on purpose here (no push keys in tests).
      if (method !== "POST" || url === "/api/push/test") continue;
      for (const body of junk) {
        const res = await call(request, method, url, body);
        expect(res.status(), `${url} with ${JSON.stringify(body)?.slice(0, 80)}`).toBeLessThan(500);
      }
    }
  });

  test("random bodies (fuzzing) never cause a server error", async ({ request, seed }) => {
    // Session and firm endpoints are left out: a lucky random body could log out or switch firm mid-run.
    const targets = ENDPOINTS(seed).filter(([m, u]) => m === "POST" && !u.startsWith("/api/firm") && !u.startsWith("/api/push"));
    const value = fc.oneof(fc.string(), fc.integer(), fc.double(), fc.boolean(), fc.constant(null), fc.uuid(), fc.date({ noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)));
    const field = fc.constantFrom("partyId", "itemId", "date", "lines", "quantity", "unit", "baseRev", "action", "name", "entryCaptureId", "inputMethod", "kind", "language", "dispatchLineId", "orderLineId", "rows", "reason");
    const body = fc.dictionary(field, fc.oneof(value, fc.array(fc.dictionary(field, value), { maxLength: 3 })), { maxKeys: 8 });
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...targets), body, async ([method, url], b) => {
        const res = await call(request, method, url, b);
        expect(res.status(), `${url} ${JSON.stringify(b).slice(0, 200)}`).toBeLessThan(500);
      }),
      { numRuns: Number(process.env.FUZZ_RUNS ?? 150), endOnFailure: true },
    );
  });

  test("invalid entries are refused with the reason, and nothing is saved", async ({ request, seed }) => {
    const before = await (await request.get(`/api/parties/${seed.gupta}/pending`)).text();
    const cases: [Record<string, unknown>, string][] = [
      [{ date: tomorrow() }, "FUTURE_DATE"],
      [{ date: "2026-02-30" }, "INVALID_DATE"],
      [{ lines: [{ itemId: seed.probe, quantity: "0" }] }, "INVALID_QTY"],
      [{ lines: [{ itemId: seed.probe, quantity: "-5" }] }, "INVALID_QTY"],
      [{ lines: [{ itemId: seed.probe, quantity: "1.234" }] }, "INVALID_QTY"],
      [{ lines: [{ itemId: seed.probe, quantity: "99999999999" }] }, "INVALID_QTY"],
      [{ lines: [{ itemId: seed.probe, quantity: "1e3" }] }, "INVALID_QTY"],
      [{ partyId: "00000000-0000-0000-0000-000000000000" }, ""],
      [{ lines: [{ itemId: "00000000-0000-0000-0000-000000000000", quantity: "1" }] }, ""],
    ];
    for (const [over, code] of cases) {
      const res = await request.post("/api/orders", { data: order(seed, over) });
      expect(res.status(), JSON.stringify(over)).toBeGreaterThanOrEqual(400);
      expect(res.status(), JSON.stringify(over)).toBeLessThan(500);
      if (code) expect((await res.json()).code, JSON.stringify(over)).toBe(code);
    }
    expect(await (await request.get(`/api/parties/${seed.gupta}/pending`)).text(), "a refused entry changed pending").toBe(before);
  });

  test("the same entry sent twice (double tap, retry) is saved once", async ({ request, seed }) => {
    const body = order(seed, { lines: [{ itemId: seed.probe, quantity: "3" }] });
    const pending = async () => JSON.stringify(await (await request.get(`/api/parties/${seed.gupta}/pending`)).json());
    const start = await pending();
    const [a, b] = await Promise.all([request.post("/api/orders", { data: body }), request.post("/api/orders", { data: body })]);
    expect(a.ok() && b.ok()).toBe(true);
    const once = await pending();
    expect(once).not.toBe(start);
    expect((await request.post("/api/orders", { data: body })).ok()).toBe(true);
    expect(await pending(), "a retry saved a second order").toBe(once);
  });

  test("a screen of another firm can't save into this one", async ({ request, seed }) => {
    const res = await request.post("/api/orders", { data: order(seed), headers: { "x-godown-firm": seed.fabricsId } });
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe("FIRM_CHANGED");
  });

  test("a firm link with a bad id goes nowhere harmful", async ({ page }) => {
    for (const to of ["abc", "00000000-0000-0000-0000-000000000000", ""]) {
      const res = await page.goto(`/firm/switch?to=${to}&next=/stock`);
      expect(res?.status(), to).toBeLessThan(500);
    }
    const open = await page.goto("/firm/switch?to=abc&next=https://evil.example.com");
    expect(new URL(page.url()).host, "must not redirect off the site").toBe(new URL(test.info().project.use.baseURL!).host);
    expect(open?.status()).toBeLessThan(500);
  });
});

test.describe("roles", () => {
  test("a viewer can look but not change anything", async ({ playwright, seed }) => {
    const r = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: stateFile("viewer") });
    expect((await r.get(`/api/reports?from=2026-01-01&to=${today()}`)).status()).toBe(200);
    for (const [url, data] of [
      ["/api/orders", order(seed)],
      ["/api/dispatches", order(seed)],
      ["/api/stock", { captureId: uid(), kind: "receipt", date: today(), lines: [{ itemId: seed.probe, quantity: "1" }] }],
      [`/api/orders/${seed.orderId}/cancel`, { baseRev: 1 }],
      ["/api/manage", { action: "renameParty", partyId: seed.sharma, name: "Hacked" }],
    ] as const) {
      const res = await r.post(url, { data });
      expect(res.status(), url).toBeGreaterThanOrEqual(400);
      expect(res.status(), url).toBeLessThan(500);
    }
    await r.dispose();
  });

  test("staff can't see the owner's screens' data", async ({ playwright }) => {
    const r = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: stateFile("staff") });
    for (const url of ["/api/activity", "/api/reports?from=2026-01-01&to=2026-12-31", "/api/import"]) {
      const res = await r.get(url);
      expect(res.status(), url).toBe(403);
    }
    await r.dispose();
  });
});
