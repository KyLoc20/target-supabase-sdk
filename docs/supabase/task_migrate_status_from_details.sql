-- Task-only: move lifecycle off JSON before deploying SDK that reads/writes `target.status`.
-- Requires Phase 0 column: docs/supabase/target_add_status_column.sql (ADD COLUMN status text NULL).
-- Run during downtime (no workers). No dual-read in SDK after this + new SDK deploy.
--
-- `target.details` may be `json` or `jsonb` — use `::jsonb` for `?` and `-` (json has no `?` operator).

BEGIN;

UPDATE public.target t
SET
    status = t.details->>'status',
    details = (t.details::jsonb - 'status')
WHERE t.category IN ('task', 'task.archived')
  AND (t.details::jsonb ? 'status');

-- Verify (expect 0):
-- SELECT count(*) FROM public.target
--   WHERE category IN ('task', 'task.archived')
--     AND (status IS NULL OR (details IS NOT NULL AND (details::jsonb ? 'status')));

COMMIT;

-- Optional claim index (run outside transaction if using CONCURRENTLY):
-- CREATE INDEX IF NOT EXISTS target_task_todo_claim
--   ON public.target (value, created_at)
--   WHERE category = 'task' AND status = 'TODO';

NOTIFY pgrst, 'reload schema';
