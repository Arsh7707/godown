CREATE TYPE "public"."attachment_kind" AS ENUM('slip_photo', 'voice_note', 'parcel_photo');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('app', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."input_method" AS ENUM('photo', 'voice', 'text', 'form');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('hi', 'en');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('open', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'staff', 'viewer');--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dispatch_line_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"capture_id" text NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dispatch_revision_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"rev" integer NOT NULL,
	"party_id" uuid NOT NULL,
	"dispatch_date" date NOT NULL,
	"taken_by" text,
	"transport" text,
	"lr_number" text,
	"parcel_photo_id" uuid,
	"notes" text,
	"status" "dispatch_status" NOT NULL,
	"channel" "channel" NOT NULL,
	"input_method" "input_method" NOT NULL,
	"source_attachment_id" uuid,
	"source_text" text,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"capture_id" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_revision_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"rev" integer NOT NULL,
	"party_id" uuid NOT NULL,
	"order_date" date NOT NULL,
	"promised_date" date,
	"notes" text,
	"status" "order_status" NOT NULL,
	"channel" "channel" NOT NULL,
	"input_method" "input_method" NOT NULL,
	"source_attachment_id" uuid,
	"source_text" text,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"capture_id" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"language" "language" DEFAULT 'hi' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_dispatch_line_id_dispatch_lines_id_fk" FOREIGN KEY ("dispatch_line_id") REFERENCES "public"."dispatch_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_dispatch_revision_id_dispatch_revisions_id_fk" FOREIGN KEY ("dispatch_revision_id") REFERENCES "public"."dispatch_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_revisions" ADD CONSTRAINT "dispatch_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_revisions" ADD CONSTRAINT "dispatch_revisions_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_revisions" ADD CONSTRAINT "dispatch_revisions_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_revisions" ADD CONSTRAINT "dispatch_revisions_parcel_photo_id_attachments_id_fk" FOREIGN KEY ("parcel_photo_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_revisions" ADD CONSTRAINT "dispatch_revisions_source_attachment_id_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_revisions" ADD CONSTRAINT "dispatch_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_aliases" ADD CONSTRAINT "item_aliases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_aliases" ADD CONSTRAINT "item_aliases_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_aliases" ADD CONSTRAINT "item_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_versions" ADD CONSTRAINT "order_line_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_versions" ADD CONSTRAINT "order_line_versions_order_revision_id_order_revisions_id_fk" FOREIGN KEY ("order_revision_id") REFERENCES "public"."order_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_versions" ADD CONSTRAINT "order_line_versions_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_versions" ADD CONSTRAINT "order_line_versions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_source_attachment_id_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_aliases" ADD CONSTRAINT "party_aliases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_aliases" ADD CONSTRAINT "party_aliases_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_aliases" ADD CONSTRAINT "party_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_dispatch_line_idx" ON "allocations" USING btree ("dispatch_line_id");--> statement-breakpoint
CREATE INDEX "allocations_order_line_idx" ON "allocations" USING btree ("order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_company_capture_kind_uq" ON "attachments" USING btree ("company_id","capture_id","kind");--> statement-breakpoint
CREATE INDEX "audit_log_company_created_idx" ON "audit_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "dispatch_lines_revision_idx" ON "dispatch_lines" USING btree ("dispatch_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_revisions_dispatch_rev_uq" ON "dispatch_revisions" USING btree ("dispatch_id","rev");--> statement-breakpoint
CREATE INDEX "dispatch_revisions_company_party_idx" ON "dispatch_revisions" USING btree ("company_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatches_company_capture_uq" ON "dispatches" USING btree ("company_id","capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_aliases_company_norm_uq" ON "item_aliases" USING btree ("company_id","normalized");--> statement-breakpoint
CREATE INDEX "items_company_idx" ON "items" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_line_versions_rev_line_uq" ON "order_line_versions" USING btree ("order_revision_id","order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_order_line_no_uq" ON "order_lines" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "order_revisions_order_rev_uq" ON "order_revisions" USING btree ("order_id","rev");--> statement-breakpoint
CREATE INDEX "order_revisions_company_party_idx" ON "order_revisions" USING btree ("company_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_company_capture_uq" ON "orders" USING btree ("company_id","capture_id");--> statement-breakpoint
CREATE INDEX "parties_company_idx" ON "parties" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_aliases_company_norm_uq" ON "party_aliases" USING btree ("company_id","normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "users_company_phone_uq" ON "users" USING btree ("company_id","phone");--> statement-breakpoint
CREATE INDEX "users_phone_idx" ON "users" USING btree ("phone");