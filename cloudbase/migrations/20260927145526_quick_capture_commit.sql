-- Atomic, service-role-only Quick Capture V2 confirmation. No legacy object is changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION public.quick_capture_v2_commit(
  p_person_id bigint,
  p_selected_display_name text,
  p_actor_uid text,
  p_interaction jsonb,
  p_facts jsonb,
  p_signals jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $body$
DECLARE
  v_person_name text;
  v_type text;
  v_at text;
  v_channel text;
  v_summary text;
  v_raw_note text;
  v_interaction_id bigint;
  v_item jsonb;
  v_item_text text;
  v_count integer := 0;
  v_kind text;
  v_items jsonb;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Authenticated actor is required' USING ERRCODE = '22023';
  END IF;
  SELECT display_name INTO v_person_name FROM public.persons
    WHERE id = p_person_id AND deleted_at IS NULL;
  IF v_person_name IS NULL OR v_person_name IS DISTINCT FROM p_selected_display_name THEN
    RAISE EXCEPTION 'Selected Person changed; resolve identity again' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_interaction) IS DISTINCT FROM 'object' OR
     jsonb_typeof(p_facts) IS DISTINCT FROM 'array' OR
     jsonb_typeof(p_signals) IS DISTINCT FROM 'array' OR
     jsonb_array_length(p_facts) > 20 OR jsonb_array_length(p_signals) > 12 THEN
    RAISE EXCEPTION 'Invalid Quick Capture V2 payload' USING ERRCODE = '22023';
  END IF;

  v_type := btrim(p_interaction->>'type');
  v_at := p_interaction->>'at';
  v_channel := nullif(btrim(p_interaction->>'channel'), '');
  v_summary := btrim(p_interaction->>'summary');
  v_raw_note := p_interaction->>'rawNote';
  IF v_type IS NULL OR length(v_type) NOT BETWEEN 1 AND 64 OR
     v_at IS NULL OR v_at !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$' OR
     v_summary IS NULL OR length(v_summary) NOT BETWEEN 1 AND 2000 OR
     v_raw_note IS NULL OR length(v_raw_note) NOT BETWEEN 1 AND 10000 OR
     (v_channel IS NOT NULL AND length(v_channel) > 100) THEN
    RAISE EXCEPTION 'Invalid Interaction candidate' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.interactions
    (person_id, interaction_type, interaction_at, channel, summary, raw_note,
     source_type, source_id, importance, created_by_uid)
  VALUES (p_person_id, v_type, v_at::timestamptz, v_channel, v_summary, v_raw_note,
          'manual', NULL, 3, btrim(p_actor_uid))
  RETURNING id INTO v_interaction_id;

  FOR v_kind, v_items IN SELECT 'fact'::text, p_facts UNION ALL SELECT 'signal'::text, p_signals LOOP
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Invalid Context Item candidate' USING ERRCODE = '22023';
      END IF;
      v_item_text := btrim(v_item #>> '{}');
      IF length(v_item_text) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Invalid Context Item candidate' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.context_items
        (person_id, interaction_id, item_type, category, content,
         source_type, source_id, confirmed)
      VALUES (p_person_id, v_interaction_id, v_kind, 'quick_capture', v_item_text,
              'ai_quick_capture_v2', v_interaction_id, false);
      v_count := v_count + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('interactionId', v_interaction_id,
                            'contextItemCount', v_count);
END;
$body$;

REVOKE ALL ON FUNCTION public.quick_capture_v2_commit(bigint, text, text, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quick_capture_v2_commit(bigint, text, text, jsonb, jsonb, jsonb)
  TO service_role;
COMMENT ON FUNCTION public.quick_capture_v2_commit(bigint, text, text, jsonb, jsonb, jsonb) IS
  'Atomic V2 confirmation from authenticated server path; AI Fact and Signal candidates stay unconfirmed';
COMMIT;
