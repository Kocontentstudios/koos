-- Every admin drill-down filters and sorts design_tickets: the dashboard's four
-- cards, each status row, the designer workload and the overdue list. Without
-- these each one is a sequential scan plus a sort whose cost grows with the
-- studio's whole history rather than with the rows actually shown.
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
