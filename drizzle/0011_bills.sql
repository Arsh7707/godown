CREATE TYPE "public"."bill_kind" AS ENUM('gst', 'kacha');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TABLE "bill_counters" (
	"company_id" uuid NOT NULL,
	"kind" "bill_kind" NOT NULL,
	"fy" text NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bill_revision_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"hsn" text,
	"quantity" numeric(12, 2) NOT NULL,
	"unit" text NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"rev" integer NOT NULL,
	"kind" "bill_kind" NOT NULL,
	"number" text NOT NULL,
	"bill_date" date NOT NULL,
	"party_id" uuid NOT NULL,
	"party" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"interstate" boolean NOT NULL,
	"charges" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"dispatch_rev" integer NOT NULL,
	"notes" text,
	"status" "bill_status" NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"share_token" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_counters" ADD CONSTRAINT "bill_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_revision_id_bill_revisions_id_fk" FOREIGN KEY ("bill_revision_id") REFERENCES "public"."bill_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_revisions" ADD CONSTRAINT "bill_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_revisions" ADD CONSTRAINT "bill_revisions_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_revisions" ADD CONSTRAINT "bill_revisions_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_revisions" ADD CONSTRAINT "bill_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_counters_uq" ON "bill_counters" USING btree ("company_id","kind","fy");--> statement-breakpoint
CREATE INDEX "bill_lines_revision_idx" ON "bill_lines" USING btree ("bill_revision_id");--> statement-breakpoint
CREATE INDEX "bill_lines_company_item_idx" ON "bill_lines" USING btree ("company_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_revisions_bill_rev_uq" ON "bill_revisions" USING btree ("bill_id","rev");--> statement-breakpoint
CREATE INDEX "bill_revisions_company_party_idx" ON "bill_revisions" USING btree ("company_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_company_dispatch_uq" ON "bills" USING btree ("company_id","dispatch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_share_token_uq" ON "bills" USING btree ("share_token");