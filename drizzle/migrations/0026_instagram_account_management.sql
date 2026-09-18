-- Instagram account management: what the photographer granted, and token refresh
-- bookkeeping. Additive only; existing connections and publications are untouched.
-- Rows connected before this migration read as the two original publishing scopes.
ALTER TABLE public.social_connections
  ADD COLUMN IF NOT EXISTS scopes text[],
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS token_refreshed_at timestamptz;

-- Studio Instagram posts are looked up by status for stale-media cleanup.
CREATE INDEX IF NOT EXISTS social_publications_instagram_status
  ON public.social_publications (owner_id, (record->>'status'))
  WHERE record->>'kind' = 'instagram-post';
