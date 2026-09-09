-- Index the columns the admin drill-downs FILTER on. Each one earns its place
-- against a specific query:
--   due_date              the overdue view filters and orders on it
--   assigned_designer_id  the designer workload drill-down and its list
--   status                every status row and every view predicate
--   created_at            the default ordering of the non-queue views
--   brand_id              ADMIN-FEAT-006's brand ticket-count link
--
-- They do NOT remove the sort. The working queue orders by
-- (priority DESC, created_at DESC, id ASC) and no composite index matches it;
-- adding one is a measurement, not a guess, and belongs with real row counts.
--
-- IF NOT EXISTS on every statement so a re-run is a no-op: the ledger in
-- scripts/migrate.mjs is the guard, but this file must also be safe to replay
-- against a database that was hand-indexed.
CREATE INDEX IF NOT EXISTS design_tickets_status_idx
  ON design_tickets (status);

CREATE INDEX IF NOT EXISTS design_tickets_due_date_idx
  ON design_tickets (due_date);

CREATE INDEX IF NOT EXISTS design_tickets_assigned_designer_idx
  ON design_tickets (assigned_designer_id);

CREATE INDEX IF NOT EXISTS design_tickets_created_at_idx
  ON design_tickets (created_at);

CREATE INDEX IF NOT EXISTS design_tickets_brand_idx
  ON design_tickets (brand_id);
