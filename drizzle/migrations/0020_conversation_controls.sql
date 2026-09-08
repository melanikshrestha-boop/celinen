-- Additive conversation controls; keeps the existing owner, quota and CAS validation.
CREATE OR REPLACE FUNCTION public.save_workspace_chat(incoming jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner uuid := auth.uid(); chat_id uuid; expected bigint; saved jsonb; prior public.workspace_chats; message jsonb; tool jsonb; used integer;
BEGIN
  IF owner IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(incoming) IS DISTINCT FROM 'object' OR octet_length(incoming::text) > 2100000
    OR NOT incoming ?& ARRAY['id','project','title','named','archived','revision','createdAt','updatedAt','messages','draft']
    OR incoming - ARRAY['id','project','title','named','archived','revision','createdAt','updatedAt','messages','draft','pinned','section','unread'] <> '{}'::jsonb
    OR jsonb_typeof(incoming->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(incoming->'title') IS DISTINCT FROM 'string'
    OR jsonb_typeof(incoming->'project') IS DISTINCT FROM 'string'
    OR jsonb_typeof(incoming->'revision') IS DISTINCT FROM 'number'
    OR jsonb_typeof(incoming->'createdAt') IS DISTINCT FROM 'number'
    OR jsonb_typeof(incoming->'updatedAt') IS DISTINCT FROM 'number'
    OR incoming->>'revision' !~ '^[0-9]+$'
    OR incoming->>'createdAt' !~ '^[1-9][0-9]*$'
    OR incoming->>'updatedAt' !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(incoming->'messages') IS DISTINCT FROM 'array'
    OR jsonb_array_length(incoming->'messages') > 500
    OR jsonb_typeof(incoming->'draft') IS DISTINCT FROM 'string'
    OR length(incoming->>'draft') <> 0 -- unsent cloud drafts must never be uploaded
    OR length(incoming->>'title') NOT BETWEEN 1 AND 80
    OR length(incoming->>'project') NOT BETWEEN 1 AND 300
    OR jsonb_typeof(incoming->'named') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(incoming->'archived') IS DISTINCT FROM 'boolean'
    OR incoming->>'revision' IS NULL
    OR (incoming ? 'pinned' AND jsonb_typeof(incoming->'pinned') IS DISTINCT FROM 'boolean')
    OR (incoming ? 'unread' AND jsonb_typeof(incoming->'unread') IS DISTINCT FROM 'boolean')
    OR (incoming ? 'section' AND (jsonb_typeof(incoming->'section') IS DISTINCT FROM 'string' OR length(incoming->>'section') > 60))
    THEN RAISE EXCEPTION 'Invalid chat'; END IF;
  chat_id := (incoming->>'id')::uuid; expected := (incoming->>'revision')::bigint;
  IF expected < 0 OR expected > 1000000000 OR (incoming->>'createdAt')::numeric > 9007199254740991 OR (incoming->>'updatedAt')::numeric > 9007199254740991 THEN RAISE EXCEPTION 'Invalid revision or time'; END IF;
  FOR message IN SELECT value FROM jsonb_array_elements(incoming->'messages') LOOP
    IF jsonb_typeof(message) IS DISTINCT FROM 'object'
      OR NOT message ?& ARRAY['role','text']
      OR message - ARRAY['role','text','tools','privateConnector'] <> '{}'::jsonb
      OR jsonb_typeof(message->'role') IS DISTINCT FROM 'string'
      OR message->>'role' NOT IN ('user','assistant')
      OR jsonb_typeof(message->'text') IS DISTINCT FROM 'string'
      OR length(message->>'text') > 32000
      OR (message ? 'privateConnector' AND jsonb_typeof(message->'privateConnector') IS DISTINCT FROM 'boolean')
      THEN RAISE EXCEPTION 'Invalid message'; END IF;
    IF message ? 'tools' THEN
      IF jsonb_typeof(message->'tools') IS DISTINCT FROM 'array' OR jsonb_array_length(message->'tools') > 40 THEN RAISE EXCEPTION 'Invalid tool receipts'; END IF;
      FOR tool IN SELECT value FROM jsonb_array_elements(message->'tools') LOOP
        IF jsonb_typeof(tool) IS DISTINCT FROM 'object' OR NOT tool ?& ARRAY['name','result'] OR tool - ARRAY['name','result'] <> '{}'::jsonb
          OR jsonb_typeof(tool->'name') IS DISTINCT FROM 'string' OR length(tool->>'name') > 120
          OR jsonb_typeof(tool->'result') IS DISTINCT FROM 'string' OR length(tool->>'result') > 32000 THEN RAISE EXCEPTION 'Invalid tool receipt'; END IF;
      END LOOP;
    END IF;
  END LOOP;
  -- Serialize the owner's admission budget, including concurrent new UUID inserts.
  PERFORM pg_advisory_xact_lock(hashtextextended(owner::text, 1));
  -- The same id is serialized even for two concurrent first saves.
  PERFORM pg_advisory_xact_lock(hashtextextended(chat_id::text, 0));
  SELECT * INTO prior FROM public.workspace_chats WHERE id = chat_id FOR UPDATE;
  IF FOUND AND (prior.owner_id <> owner OR prior.project <> incoming->>'project') THEN
    RAISE EXCEPTION 'Chat unavailable' USING ERRCODE = '42501';
  END IF;
  IF coalesce((prior.record->>'revision')::bigint, 0) <> expected THEN
    RAISE EXCEPTION 'Chat changed in another tab' USING ERRCODE = '40001';
  END IF;
  saved := incoming || jsonb_build_object('revision', expected + 1,
    'pinned', coalesce(incoming->'pinned', prior.record->'pinned', 'false'::jsonb),
    'section', coalesce(incoming->'section', prior.record->'section', '""'::jsonb),
    'unread', coalesce(incoming->'unread', prior.record->'unread', 'false'::jsonb));
  IF prior.id IS NULL AND (SELECT count(*) FROM public.workspace_chats WHERE owner_id = owner) >= 500 THEN RAISE EXCEPTION 'Conversation limit reached'; END IF;
  IF (SELECT coalesce(sum(octet_length(record::text)), 0) FROM public.workspace_chats WHERE owner_id = owner AND id <> chat_id) + octet_length(saved::text) > 52428800 THEN RAISE EXCEPTION 'Chat storage limit reached'; END IF;
  INSERT INTO public.workspace_chat_write_limits(owner_id) VALUES(owner) ON CONFLICT DO NOTHING;
  UPDATE public.workspace_chat_write_limits SET
    writes = CASE WHEN window_started < now() - interval '1 minute' THEN 1 ELSE writes + 1 END,
    window_started = CASE WHEN window_started < now() - interval '1 minute' THEN now() ELSE window_started END
    WHERE owner_id = owner RETURNING writes INTO used;
  IF used > 300 THEN RAISE EXCEPTION 'Chat save rate limit reached'; END IF;
  INSERT INTO public.workspace_chats(id, owner_id, project, record)
    VALUES(chat_id, owner, incoming->>'project', saved)
    ON CONFLICT (id) DO UPDATE SET record = saved, updated_at = now();
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_workspace_chat(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_workspace_chat(jsonb) TO authenticated;

CREATE FUNCTION public.delete_workspace_chat(chat_id uuid, expected_project text, expected_revision bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner uuid := auth.uid(); prior public.workspace_chats;
BEGIN
  IF owner IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501'; END IF;
  IF chat_id IS NULL OR expected_project IS NULL OR length(expected_project) NOT BETWEEN 1 AND 300
    OR expected_revision IS NULL OR expected_revision < 1 OR expected_revision > 1000000001 THEN
    RAISE EXCEPTION 'Invalid delete request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(owner::text, 1));
  PERFORM pg_advisory_xact_lock(hashtextextended(chat_id::text, 0));
  SELECT * INTO prior FROM public.workspace_chats WHERE id = chat_id FOR UPDATE;
  IF prior.id IS NULL OR prior.owner_id <> owner OR prior.project <> expected_project THEN
    RAISE EXCEPTION 'Chat unavailable' USING ERRCODE = '42501';
  END IF;
  IF (prior.record->>'revision')::bigint <> expected_revision THEN
    RAISE EXCEPTION 'Chat changed in another tab' USING ERRCODE = '40001';
  END IF;
  DELETE FROM public.workspace_chats WHERE id = chat_id AND owner_id = owner;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.delete_workspace_chat(uuid,text,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_workspace_chat(uuid,text,bigint) TO authenticated;
