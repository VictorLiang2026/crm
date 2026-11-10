BEGIN;
SET LOCAL lock_timeout='4s';
CREATE TABLE public.crm_device_file_uploads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor text NOT NULL, fingerprint text NOT NULL,
 bucket text NOT NULL CHECK(bucket IN ('recruit','knowledge')),object_path text NOT NULL,content_type text NOT NULL,
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 100000000),expires_at timestamptz NOT NULL DEFAULT(clock_timestamp()+interval '1 hour'));
CREATE INDEX crm_device_file_upload_expiry ON public.crm_device_file_uploads(expires_at);
CREATE TABLE public.crm_device_file_parts(upload_id uuid NOT NULL REFERENCES public.crm_device_file_uploads(id) ON DELETE CASCADE,
 part_no integer NOT NULL,body text NOT NULL,PRIMARY KEY(upload_id,part_no));
ALTER TABLE public.crm_device_file_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_device_file_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_device_file_uploads,public.crm_device_file_parts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.crm_device_file_stage_v1(p_op text,p_actor text,p_fp text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE u public.crm_device_file_uploads%ROWTYPE; i integer; part text; expected integer; part_size constant integer:=393216;
BEGIN
 IF NOT EXISTS(SELECT FROM public.crm_access_members m JOIN public.crm_browser_devices b ON b.uid=m.uid WHERE m.uid=p_actor AND m.enabled AND b.fingerprint=p_fp AND b.state='approved' FOR UPDATE OF m,b) THEN RAISE EXCEPTION 'DEVICE_ACCESS_DENIED'; END IF;
 DELETE FROM public.crm_device_file_uploads WHERE expires_at<=clock_timestamp();
 IF p_op='begin' THEN
  IF (SELECT count(*) FROM public.crm_device_file_uploads WHERE actor=p_actor)>=4 THEN RAISE EXCEPTION 'UPLOAD_LIMIT'; END IF;
  INSERT INTO public.crm_device_file_uploads(actor,fingerprint,bucket,object_path,content_type,bytes)
   VALUES(p_actor,p_fp,p->>'bucket',p->>'path',p->>'type',(p->>'bytes')::integer) RETURNING * INTO u;
 ELSE
  SELECT * INTO STRICT u FROM public.crm_device_file_uploads WHERE id=(p->>'id')::uuid AND actor=p_actor AND fingerprint=p_fp FOR UPDATE;
  IF p_op IN ('put','read') THEN
   i:=(p->>'i')::integer; IF i IS NULL OR i<0 OR i>(u.bytes-1)/part_size THEN RAISE EXCEPTION 'INVALID_PART'; END IF;
   expected:=least(part_size,u.bytes-i*part_size);
   IF p_op='put' THEN
    part:=p->>'part'; IF part IS NULL OR length(part)<>4*((expected+2)/3) OR octet_length(decode(part,'base64'))<>expected THEN RAISE EXCEPTION 'INVALID_PART'; END IF;
    INSERT INTO public.crm_device_file_parts VALUES(u.id,i,part) ON CONFLICT DO NOTHING;
    IF NOT FOUND AND (SELECT body FROM public.crm_device_file_parts WHERE upload_id=u.id AND part_no=i)<>part THEN RAISE EXCEPTION 'PART_CONFLICT'; END IF;
   ELSE SELECT body INTO STRICT part FROM public.crm_device_file_parts WHERE upload_id=u.id AND part_no=i; RETURN jsonb_build_object('part',part); END IF;
  ELSIF p_op='finish' THEN
   IF (SELECT count(*) FROM public.crm_device_file_parts WHERE upload_id=u.id)<>(u.bytes+part_size-1)/part_size THEN RAISE EXCEPTION 'UPLOAD_INCOMPLETE'; END IF;
  ELSIF p_op='drop' THEN DELETE FROM public.crm_device_file_uploads WHERE id=u.id;
  ELSE RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
 END IF;
 RETURN jsonb_build_object('id',u.id,'bucket',u.bucket,'path',u.object_path,'bytes',u.bytes,'type',u.content_type);
END $fn$;
REVOKE ALL ON FUNCTION public.crm_device_file_stage_v1(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_device_file_stage_v1(text,text,text,jsonb) TO service_role;
COMMIT;
