ALTER TABLE "companies" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bank_account" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bank_ifsc" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "upi_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bill_prefix" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "hsn" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "gst_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "supervisor" boolean DEFAULT false NOT NULL;