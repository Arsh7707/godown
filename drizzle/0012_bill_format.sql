ALTER TABLE "bill_revisions" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "bill_revisions" ADD COLUMN "destination" text;--> statement-breakpoint
ALTER TABLE "bill_revisions" ADD COLUMN "docket" text;--> statement-breakpoint
ALTER TABLE "bill_revisions" ADD COLUMN "payment_terms" text;--> statement-breakpoint
ALTER TABLE "bill_revisions" ADD COLUMN "ship_to" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "email" text;