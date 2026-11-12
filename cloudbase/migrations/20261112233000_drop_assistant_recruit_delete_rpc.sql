-- Retire the unreachable PC28 executor; keep its historical audit rows.
DROP FUNCTION public.assistant_recruit_delete_command_v1(text,text,uuid,uuid,bigint,bigint,text,text,text);
