-- Ledger and audit tables are append-only: reject UPDATE and DELETE.
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','order_revisions','order_lines','order_line_versions',
                           'dispatches','dispatch_revisions','dispatch_lines','allocations','audit_log']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()',
                   t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation()',
                   t || '_no_truncate', t);
  END LOOP;
END $$;
