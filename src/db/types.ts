import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Works for the postgres-js client, PGlite (tests), and transactions of either. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
