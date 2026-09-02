ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS auth_user_id uuid;

CREATE INDEX IF NOT EXISTS clients_auth_user_id_idx ON public.clients (auth_user_id);
CREATE INDEX IF NOT EXISTS clients_email_idx ON public.clients (lower(email));

CREATE OR REPLACE FUNCTION public.my_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.clients
  WHERE auth_user_id = auth.uid()
     OR (email IS NOT NULL AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

REVOKE ALL ON FUNCTION public.my_client_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_client_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_client_records()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  UPDATE public.clients
     SET auth_user_id = auth.uid()
   WHERE auth_user_id IS NULL
     AND email IS NOT NULL
     AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_client_records() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_client_records() TO authenticated;

CREATE POLICY "client reads own record"
  ON public.clients FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_client_ids()));

CREATE POLICY "client reads own shoots"
  ON public.shoots FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.my_client_ids()));

CREATE POLICY "client reads own invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.my_client_ids()));

CREATE POLICY "client reads own galleries"
  ON public.galleries FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.my_client_ids()));