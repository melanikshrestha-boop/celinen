-- Story broadcasts: one hearted set sent to several story destinations at once.
-- Additive only. Broadcasts share `social_publications` with Instagram feed
-- posts and delivery publications; they are told apart by record->>'kind'.
-- No new table, no new column, no change to any existing row.

-- The sweep reads unposted broadcasts by owner and age, and the composer lists
-- the recent ones. Partial, like the Instagram post index beside it.
CREATE INDEX IF NOT EXISTS social_publications_story_broadcast_status
  ON public.social_publications (owner_id, (record->>'status'))
  WHERE record->>'kind' = 'story-broadcast';
