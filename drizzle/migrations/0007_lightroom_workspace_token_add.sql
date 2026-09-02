ALTER TABLE public.lightroom_workspaces ADD COLUMN IF NOT EXISTS token text;
ALTER TABLE public.lightroom_workspaces ALTER COLUMN token_hash DROP NOT NULL;