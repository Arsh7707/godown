/** Settings shared by the Playwright config, setup and specs. */
export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE = `http://localhost:${PORT}`;
export const DB_URL = process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/godown_e2e";
export const SEED_FILE = "e2e/.state/seed.json";

/** Test logins (10 digits as typed on the login screen). */
export const PHONES = { owner: "9000000001", staff: "9000000002", viewer: "9000000003" } as const;
export type RoleName = keyof typeof PHONES;

/**
 * The browser tests reset this database. Refuse anything that is not on this
 * machine (or the CI service container), so they can never touch production.
 */
export function assertLocalDb(url = DB_URL) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error(`E2E_DATABASE_URL must point at a local database, not ${host}`);
  }
}
