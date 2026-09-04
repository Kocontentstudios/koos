-- When the studio FIRST delivered a ticket.
--
-- Distinct from approved_at (when the client signed off) and from created_at.
-- ADMIN-FEAT-002 lists work by delivery date, and the previous unit had to drop
-- a `delivered` date anchor because there was no column behind it — anchoring
-- it to created_at would have answered a different question silently.
--
-- Written only on version 1 (see recordDeliverableVersion): a correction round
-- is not a new delivery, and overwriting this on every upload would make an
-- old ticket look freshly delivered every time it was revised.
ALTER TABLE design_tickets
  ADD COLUMN IF NOT EXISTS delivered_at timestamp;

-- Backfill exactly: the earliest deliverable is the first delivery.
UPDATE design_tickets t
SET delivered_at = d.first_delivery
FROM (
  SELECT ticket_id, min(created_at) AS first_delivery
  FROM design_deliverables
  GROUP BY ticket_id
) d
WHERE d.ticket_id = t.id
  AND t.delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS design_tickets_delivered_at_idx
  ON design_tickets (delivered_at);
