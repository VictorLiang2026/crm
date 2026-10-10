-- ROLLBACK for 20261010170700. Restores the exact bridge function/trigger originally
-- created in 20261004011800_person_directory_roles.sql. It references
-- persons.legacy_customer_id and the 7 customers copy columns, so it is only consistent
-- inside the full reversal chain (apply 20261010180000 and 20261010164100 rollbacks
-- first, plus pre-CL-02 application code).
CREATE FUNCTION public.customer_person_identity_bridge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $bridge$
BEGIN
  UPDATE public.persons p SET
    display_name=NEW.customer_name,
    name_key=lower(regexp_replace(btrim(regexp_replace(translate(NEW.customer_name,'　',' '),
      '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$','')),'[[:space:]]+',' ','g')),
    phone=NEW.phone,wechat=NEW.wx_account,gender=NEW.gender,
    birthday=NEW.birthday,occupation=NEW.occupation,education=NEW.education,
    updated_at=coalesce(NEW.updated_at,now())
  WHERE p.legacy_customer_id=NEW."Id" AND p.deleted_at IS NULL;
  RETURN NEW;
END $bridge$;
REVOKE ALL ON FUNCTION public.customer_person_identity_bridge() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER customer_person_identity_bridge_trigger
  AFTER UPDATE OF customer_name,phone,wx_account,gender,birthday,occupation,education
  ON public.customers FOR EACH ROW
  WHEN (OLD.customer_name IS DISTINCT FROM NEW.customer_name OR
    OLD.phone IS DISTINCT FROM NEW.phone OR OLD.wx_account IS DISTINCT FROM NEW.wx_account OR
    OLD.gender IS DISTINCT FROM NEW.gender OR OLD.birthday IS DISTINCT FROM NEW.birthday OR
    OLD.occupation IS DISTINCT FROM NEW.occupation OR OLD.education IS DISTINCT FROM NEW.education)
  EXECUTE FUNCTION public.customer_person_identity_bridge();
