-- ROLLBACK for 20261010164100_pmc19_cl02_drop_customer_copy_columns.sql
-- Restores the 7 customers copy columns WITH REAL VALUES backfilled from persons (the
-- authority), then restores the pmc18 basic-fields audit function and trigger.
--
-- Recovery semantics for records created AFTER CL-02:
--   Every customer created after the drop carries a NOT NULL customers.person_id
--   (constraint customers_person_id_fkey, PMC-17), so the UPDATE ... FROM persons below
--   restores their copy values too; nothing is left as an empty column. Soft-deleted
--   customers are included (their Person rows are retained, also soft-deleted).
--
-- Chain ordering: this rollback assumes persons columns display_name/phone/birthday/
-- gender/occupation/education/wechat are intact (they are the authority). Apply BEFORE
-- redeploying pre-CL-02 application code (tag release-20261010093000). If you also need
-- the UNIQUE(customer_name) constraint, run 20261010163200 CL-01 rollback afterwards and
-- resolve duplicate names first.
ALTER TABLE public.customers
  ADD COLUMN customer_name text,
  ADD COLUMN phone text,
  ADD COLUMN birthday date,
  ADD COLUMN gender text,
  ADD COLUMN occupation text,
  ADD COLUMN education text,
  ADD COLUMN wx_account text;

UPDATE public.customers AS c
SET customer_name = p.display_name,
    phone = p.phone,
    birthday = p.birthday,
    gender = p.gender,
    occupation = p.occupation,
    education = p.education,
    wx_account = p.wechat
FROM public.persons AS p
WHERE p.id = c.person_id;

-- Pre-CL-02 customer_name was NOT NULL. persons.display_name is NOT NULL and the
-- customers -> persons link is complete (0 missing since PMC-17), then and now.
ALTER TABLE public.customers ALTER COLUMN customer_name SET NOT NULL;

-- Restore pmc18 basic-fields audit (exact body from 20261010115000 PMC-18).
CREATE OR REPLACE FUNCTION public.pmc18_customers_basics_audit_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_via_person boolean := (pg_trigger_depth() > 1);
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF NEW.customer_name IS DISTINCT FROM OLD.customer_name THEN v_changed := v_changed || 'customer_name'; END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN v_changed := v_changed || 'phone'; END IF;
  IF NEW.wx_account IS DISTINCT FROM OLD.wx_account THEN v_changed := v_changed || 'wx_account'; END IF;
  IF NEW.gender IS DISTINCT FROM OLD.gender THEN v_changed := v_changed || 'gender'; END IF;
  IF NEW.birthday IS DISTINCT FROM OLD.birthday THEN v_changed := v_changed || 'birthday'; END IF;
  IF NEW.occupation IS DISTINCT FROM OLD.occupation THEN v_changed := v_changed || 'occupation'; END IF;
  IF NEW.education IS DISTINCT FROM OLD.education THEN v_changed := v_changed || 'education'; END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pmc18_observations(observed_at, metric, value, level, detail)
  VALUES (
    now(),
    'customers_basics_update',
    'via_person_service=' || v_via_person::text,
    CASE WHEN v_via_person THEN 'info' ELSE 'warning' END,
    jsonb_build_object(
      'customer_id', NEW."Id",
      'changed_fields', v_changed,
      'trigger_depth', pg_trigger_depth()
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pmc18_customers_basics_audit ON public.customers;
CREATE TRIGGER pmc18_customers_basics_audit
  AFTER UPDATE OF customer_name, phone, wx_account, gender, birthday, occupation, education
  ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.pmc18_customers_basics_audit_fn();

-- Known recovery limitation: any customer-side value that had already diverged from the
-- Person before CL-02 and was never projected back is not recoverable from the live DB
-- (the copy column was the only store). The platform fallback is CloudBase PostgreSQL
-- backup/PITR (Tencent Cloud PostgreSQL, console: PostgreSQL instance -> Backup & Restore;
-- capability documented at https://docs.cloudbase.net/database/postgresql/backup).
-- The instance's actual backup retention was not console-verified in PMC-20; a manual
-- backup + restore drill is recorded as a pending operational item in the PMC-20 handoff.
