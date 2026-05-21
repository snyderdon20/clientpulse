-- Backfill completed_appointments_count for all existing clients.
-- The column was added with DEFAULT 0, so every pre-existing row is zero.
-- Count all appointments with a terminal "visited" status per client.
UPDATE clients c
SET completed_appointments_count = (
  SELECT COUNT(*)
  FROM appointments a
  WHERE a.client_id = c.id
    AND a.status IN ('completed', 'checked-in')
);

-- Also ensure last_visit reflects the most recent completed appointment
-- for any client where it is not yet populated.
UPDATE clients c
SET last_visit = sub.latest
FROM (
  SELECT client_id, MAX(date) AS latest
  FROM appointments
  WHERE status IN ('completed', 'checked-in')
  GROUP BY client_id
) sub
WHERE sub.client_id = c.id
  AND c.last_visit IS NULL;
