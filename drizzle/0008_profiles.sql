ALTER TABLE "companies" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "tax_id_type" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stock_keeper" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "parties_company_gstin_uq" ON "parties" USING btree ("company_id","tax_id") WHERE "parties"."tax_id_type" = 'gstin';--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tax_id_chk" CHECK (("tax_id_type" IS NULL AND "tax_id" IS NULL) OR ("tax_id_type" IN ('gstin', 'aadhaar') AND "tax_id" IS NOT NULL));
