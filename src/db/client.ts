import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// prepare: false keeps this compatible with Supabase's transaction pooler.
export const db = drizzle(postgres(url, { prepare: false }), { schema });
