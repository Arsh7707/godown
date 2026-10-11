CREATE TYPE "public"."stock_kind" AS ENUM('receipt', 'count', 'adjustment', 'reversal');--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"capture_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "stock_kind" NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"counted" numeric(12, 2),
	"entry_date" date NOT NULL,
	"reason" text,
	"reverses_id" uuid,
	"channel" "channel" NOT NULL,
	"input_method" "input_method" NOT NULL,
	"source_attachment_id" uuid,
	"source_text" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "product" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "low_stock_level" numeric(12, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_attachment_id_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_company_capture_uq" ON "stock_movements" USING btree ("company_id","capture_id");--> statement-breakpoint
CREATE INDEX "stock_movements_company_item_idx" ON "stock_movements" USING btree ("company_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_movements_batch_idx" ON "stock_movements" USING btree ("batch_id");