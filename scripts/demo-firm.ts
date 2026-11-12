/**
 * Adds the demo firm (see src/dev/demo-firm.ts) to whichever database
 * DATABASE_URL points at, with the given number as its owner.
 *
 *   npm run demo:firm -- +15555550123 "Owner name"
 *
 * Safe to run on the live database: it only adds a new firm, and refuses if
 * that number already owns one with the same name.
 */
import { db } from "@/db/client";
import { createDemoFirm, DemoFirmExists } from "@/dev/demo-firm";

const [phone, ownerName] = process.argv.slice(2);
if (!phone) {
  console.error('Usage: npm run demo:firm -- +15555550123 "Owner name"');
  process.exit(1);
}
createDemoFirm(db, { ownerPhone: phone, ownerName }).then(
  (firm) => {
    console.log(`Created ${firm.name}. Log in with ${phone} and pick it from the firm list.`);
    process.exit(0);
  },
  (e) => {
    console.error(e instanceof DemoFirmExists ? `Nothing added: ${e.message}.` : e);
    process.exit(1);
  },
);
