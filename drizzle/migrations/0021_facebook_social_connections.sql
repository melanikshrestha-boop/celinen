-- Server-only credentials; existing Instagram and publication records are preserved.
CREATE TABLE public.facebook_social_connections (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pages_credential text NOT NULL CHECK (octet_length(pages_credential) <= 200000),
  selected_page_id text,
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.facebook_social_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facebook_social_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.facebook_social_connections TO service_role;
