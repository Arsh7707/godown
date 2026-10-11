/** Creates a fresh demo company in the local database. Usage: npm run seed:demo */
import { db } from "@/db/client";
import { createDemoCompany } from "@/dev/demo";

createDemoCompany(db).then(
  (c) => {
    console.log(`Created ${c.name}`);
    process.exit(0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
