ALTER TABLE "dispatch_lines" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "order_line_versions" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "unit" text;