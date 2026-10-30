-- Approved Person interaction consolidation. Public only; no source records removed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog;
ALTER TABLE public.interactions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.interactions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.interactions ADD COLUMN IF NOT EXISTS request_key uuid;
ALTER TABLE public.interactions ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE UNIQUE INDEX IF NOT EXISTS interactions_request_uidx ON public.interactions(created_by_uid,request_key) WHERE request_key IS NOT NULL;
ALTER TABLE public.interactions ADD COLUMN IF NOT EXISTS time_precision text NOT NULL DEFAULT 'instant'
  CHECK (time_precision IN ('instant','day','unknown'));
ALTER TABLE public.interactions ALTER COLUMN interaction_at DROP NOT NULL;
ALTER TABLE public.followups ADD COLUMN IF NOT EXISTS interaction_id bigint REFERENCES public.interactions(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS followups_interaction_id_uidx ON public.followups(interaction_id) WHERE interaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_followup_interaction_sync_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE pid bigint; iid bigint; at_value timestamptz; precision_value text;
BEGIN
  -- Nested writes are the other side of this same bridge, not a new event.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE public.interactions SET deleted_at=COALESCE(deleted_at,clock_timestamp()),updated_at=clock_timestamp()
      WHERE source_type='followups' AND source_id=OLD."Id";
    RETURN OLD;
  END IF;
  SELECT person_id INTO pid FROM public.customers WHERE "Id"=NEW.customer_id;
  IF pid IS NULL THEN RAISE EXCEPTION 'FOLLOWUP_PERSON_REQUIRED'; END IF;
  at_value := COALESCE(NEW.followup_date::timestamp AT TIME ZONE 'Asia/Shanghai',NEW.created_at);
  precision_value := CASE WHEN NEW.followup_date IS NOT NULL THEN 'day' WHEN at_value IS NOT NULL THEN 'instant' ELSE 'unknown' END;
  SELECT id INTO iid FROM public.interactions WHERE source_type='followups' AND source_id=NEW."Id";
  IF NEW.interaction_id IS NOT NULL AND NEW.interaction_id IS DISTINCT FROM iid THEN
    RAISE EXCEPTION 'INTERACTION_LINK_MISMATCH';
  END IF;
  IF iid IS NULL THEN
    INSERT INTO public.interactions(person_id,interaction_type,interaction_at,time_precision,summary,raw_note,activity_id,source_type,source_id,deleted_at)
      VALUES(pid,'followup',at_value,precision_value,
        LEFT(COALESCE(NULLIF(btrim(NEW.interaction_summary),''),NULLIF(btrim(NEW.followup_notes),''),'客户跟进'),2000),
        NEW.followup_notes,NEW.activity_id,'followups',NEW."Id",NEW.deleted_at) RETURNING id INTO iid;
  ELSE
    UPDATE public.interactions SET person_id=pid,
      interaction_at=CASE WHEN TG_OP='INSERT' OR NEW.followup_date IS DISTINCT FROM OLD.followup_date THEN at_value ELSE interaction_at END,
      time_precision=CASE WHEN TG_OP='INSERT' OR NEW.followup_date IS DISTINCT FROM OLD.followup_date THEN precision_value ELSE time_precision END,
      summary=LEFT(COALESCE(NULLIF(btrim(NEW.interaction_summary),''),NULLIF(btrim(NEW.followup_notes),''),'客户跟进'),2000),
      raw_note=NEW.followup_notes,activity_id=NEW.activity_id,deleted_at=NEW.deleted_at,updated_at=clock_timestamp()
      WHERE id=iid;
  END IF;
  NEW.interaction_id := iid;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_followup_interaction_sync_v1() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.crm_interaction_followup_sync_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.source_type <> 'followups' THEN RETURN NEW; END IF;
  IF (NEW.summary,NEW.raw_note,NEW.interaction_at,NEW.activity_id,NEW.deleted_at)
      IS DISTINCT FROM (OLD.summary,OLD.raw_note,OLD.interaction_at,OLD.activity_id,OLD.deleted_at) THEN
    UPDATE public.followups SET interaction_summary=NEW.summary,followup_notes=NEW.raw_note,
      followup_date=CASE WHEN NEW.interaction_at IS DISTINCT FROM OLD.interaction_at
        THEN (NEW.interaction_at AT TIME ZONE 'Asia/Shanghai')::date ELSE followup_date END,
      activity_id=NEW.activity_id,deleted_at=NEW.deleted_at,updated_at=clock_timestamp() AT TIME ZONE 'Asia/Shanghai'
      WHERE "Id"=NEW.source_id AND interaction_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_interaction_followup_sync_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_followup_interaction_sync BEFORE INSERT OR UPDATE ON public.followups
  FOR EACH ROW EXECUTE FUNCTION public.crm_followup_interaction_sync_v1();
CREATE TRIGGER crm_followup_interaction_delete AFTER DELETE ON public.followups
  FOR EACH ROW EXECUTE FUNCTION public.crm_followup_interaction_sync_v1();
CREATE TRIGGER crm_interaction_followup_sync AFTER UPDATE ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION public.crm_interaction_followup_sync_v1();

-- Each historical source is materialized once. Original legacy fields stay byte-for-byte unchanged.
UPDATE public.followups SET interaction_id=interaction_id WHERE interaction_id IS NULL;

-- Append to existing view without dropping it or changing its existing column positions/grants.
DO $$ DECLARE definition text;
BEGIN
  SELECT pg_get_viewdef('public.followups_view'::regclass,true) INTO definition;
  EXECUTE 'CREATE OR REPLACE VIEW public.followups_view AS SELECT old_view.*, f.interaction_id FROM (' ||
    regexp_replace(definition,';\s*$','') || ') old_view JOIN public.followups f ON f."Id"=old_view."Id"';
END $$;
COMMENT ON COLUMN public.followups.interaction_id IS 'Canonical Person interaction; legacy common fields are compatibility mirrors.';
COMMENT ON COLUMN public.interactions.time_precision IS 'instant=known timestamp, day=legacy calendar date, unknown=no known event timestamp';
NOTIFY pgrst,'reload schema';
COMMIT;
