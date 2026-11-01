-- Phase 0: nullable `target.status` (Task / Node / … use per-domain migration).
-- Safe to re-run.

ALTER TABLE public.target
    ADD COLUMN IF NOT EXISTS status text NULL;

COMMENT ON COLUMN public.target.status IS
    'Optional domain lifecycle (string enum per category). NULL when unused.';

NOTIFY pgrst, 'reload schema';
