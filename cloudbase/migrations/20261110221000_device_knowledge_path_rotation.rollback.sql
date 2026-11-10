BEGIN;
SET LOCAL lock_timeout='4s';
LOCK TABLE public.crm_knowledge_path_rotation IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.crm_knowledge_path_rotation WHERE phase<>'copy' OR lease IS NOT NULL)
 OR EXISTS(SELECT FROM public.crm_knowledge_path_rotation r JOIN storage.objects o ON o.bucket_id='knowledge' AND o.name=r.new_key)
 THEN RAISE EXCEPTION 'Rotation started: preserve copies, manifest and references; recover individually'; END IF;
END $$;
DROP FUNCTION public.crm_knowledge_path_rotation_v1(text,bigint,uuid,text);
DROP TABLE public.crm_knowledge_path_rotation;
COMMIT;
