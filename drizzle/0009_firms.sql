ALTER TABLE "companies" ADD COLUMN "stock_company_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_stock_company_id_companies_id_fk" FOREIGN KEY ("stock_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_stock_not_self_chk" CHECK ("stock_company_id" IS NULL OR "stock_company_id" <> "id");--> statement-breakpoint
CREATE INDEX "companies_stock_company_idx" ON "companies" USING btree ("stock_company_id");
