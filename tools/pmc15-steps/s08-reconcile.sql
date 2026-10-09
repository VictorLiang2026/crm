DO $do$
BEGIN
  EXECUTE 'DELETE FROM public.person_roles WHERE id IN (703, 792)';
  EXECUTE 'INSERT INTO public.person_roles (person_id, role, origin) VALUES (777, ''customer'', ''derived''), (777, ''recruit'', ''derived'') ON CONFLICT (person_id, role) DO NOTHING';
END $do$;
