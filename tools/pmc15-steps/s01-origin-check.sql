DO $do$
BEGIN
  EXECUTE 'ALTER TABLE public.person_roles DROP CONSTRAINT person_roles_origin_check';
  EXECUTE 'ALTER TABLE public.person_roles ADD CONSTRAINT person_roles_origin_check CHECK (origin IN (''manual'', ''legacy_backfill'', ''derived''))';
END $do$;
