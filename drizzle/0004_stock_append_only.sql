-- Stock movements are append-only, like the order/dispatch ledger.
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
--> statement-breakpoint
-- Existing items: their product is their own name.
UPDATE items SET product = name WHERE product IS NULL;
