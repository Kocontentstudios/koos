CREATE TABLE IF NOT EXISTS design_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES design_tickets(id) ON DELETE CASCADE,
  deliverable_id uuid NOT NULL REFERENCES design_deliverables(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shapes jsonb NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS design_annotations_ticket_id_idx ON design_annotations(ticket_id);
