/** Logs in once per role and saves the session for the other specs. */
import { writeFileSync } from "node:fs";
import { test as setup, expect } from "@playwright/test";
import { PHONES, type RoleName } from "./env";
import { stateFile } from "./fixtures";

for (const role of Object.keys(PHONES) as RoleName[]) {
  setup(`log in as ${role}`, async ({ request }) => {
    const phone = PHONES[role];
    const req = await request.post("/api/auth/request", { data: { phone } });
    expect(req.ok(), await req.text()).toBeTruthy();
    const { devCode } = await req.json();
    let v = await (await request.post("/api/auth/verify", { data: { phone, code: devCode } })).json();
    if (v.code === "CHOOSE_COMPANY") {
      const firm = v.companies.find((c: { name: string }) => c.name === "E2E Textiles");
      v = await (await request.post("/api/auth/verify", { data: { phone, code: devCode, companyId: firm.id } })).json();
    }
    expect(v.ok, JSON.stringify(v)).toBe(true);
    // The test server is plain http on localhost; Safari's engine (unlike Chrome) won't send a
    // "secure" cookie there. The saved login drops the flag; the live https site keeps it.
    const state = await request.storageState();
    writeFileSync(stateFile(role), JSON.stringify({ ...state, cookies: state.cookies.map((c) => ({ ...c, secure: false })) }));
  });
}
