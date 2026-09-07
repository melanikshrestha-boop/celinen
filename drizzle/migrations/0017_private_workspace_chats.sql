-- Owner-only workspace history. No service-role key or client-supplied owner.
CREATE TABLE public.workspace_chats (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  project text NOT NULL CHECK (length(project) BETWEEN 1 AND 300),
  record jsonb NOT NULL CHECK (octet_length(record::text) <= 2100000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_chats_owner_project ON public.workspace_chats(owner_id, project, updated_at DESC);
ALTER TABLE public.workspace_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_chat_owner_read ON public.workspace_chats FOR SELECT TO authenticated USING (owner_id = auth.uid());
REVOKE ALL ON public.workspace_chats FROM anon, authenticated;
GRANT SELECT ON public.workspace_chats TO authenticated;
CREATE TABLE public.workspace_chat_write_limits (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started timestamptz NOT NULL DEFAULT now(),
  writes integer NOT NULL DEFAULT 0
);
ALTER TABLE public.workspace_chat_write_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_chat_write_limits FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_workspace_chat(incoming jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner uuid := auth.uid(); chat_id uuid; expected bigint; saved jsonb; prior public.workspace_chats; message jsonb; tool jsonb; used integer;
BEGIN
  IF owner IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(incoming) IS DISTINCT FROM 'object' OR octet_length(incoming::text) > 2100000
    OR NOT incoming ?& ARRAY['id','project','title','named','archived','revision','createdAt','updatedAt','messages','draft']
    OR incoming - ARRAY['id','project','title','named','archived','revision','createdAt','updatedAt','messages','draft'] <> '{}'::jsonb
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
  saved := incoming || jsonb_build_object('revision', expected + 1);
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
