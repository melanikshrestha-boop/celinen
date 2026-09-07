-- Additive launch controls. No existing galleries, originals or history are removed.
-- Reserve small safety headroom above the original hard cap for closing historical rooms.
-- New application writes are capped at 4 MiB, well below this last-resort database guard.
ALTER TABLE public.delivery_rooms DROP CONSTRAINT delivery_rooms_state_check;
ALTER TABLE public.delivery_rooms ADD CONSTRAINT delivery_rooms_state_check
  CHECK (state->>'format' = '1' AND octet_length(state::text) <= 16781312);
--> statement-breakpoint
CREATE TABLE public.delivery_owner_limits (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id),
  enabled boolean NOT NULL DEFAULT true,
  byte_limit bigint NOT NULL DEFAULT 10737418240 CHECK (byte_limit > 0),
  object_limit integer NOT NULL DEFAULT 10000 CHECK (object_limit > 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  reserved_objects integer NOT NULL DEFAULT 0 CHECK (reserved_objects >= 0)
);
--> statement-breakpoint
CREATE TABLE public.delivery_upload_budget (
  gallery_id uuid NOT NULL REFERENCES public.delivery_rooms(id),
  version_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.delivery_owner_limits(owner_id),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  charged_bytes bigint NOT NULL DEFAULT 94371840,
  settled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (gallery_id, version_id)
);
--> statement-breakpoint
CREATE TABLE public.delivery_verification_slots (
  slot smallint PRIMARY KEY CHECK (slot IN (1, 2)),
  owner_id uuid,
  lease_token uuid,
  expires_at timestamptz
);
INSERT INTO public.delivery_verification_slots(slot) VALUES (1), (2);
--> statement-breakpoint
CREATE TABLE public.delivery_safety_events (
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  operation_id uuid NOT NULL,
  gallery_id uuid NOT NULL REFERENCES public.delivery_rooms(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL DEFAULT 'closed',
  PRIMARY KEY (owner_id, operation_id)
);
--> statement-breakpoint
-- Preserve and account for pre-guard deliveries; existing owners need explicit pilot approval.
INSERT INTO public.delivery_owner_limits(owner_id, enabled)
  SELECT DISTINCT owner_id, false FROM public.delivery_rooms ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_upload_budget(gallery_id, version_id, owner_id, fingerprint, charged_bytes, settled)
  SELECT r.id, (v->>'id')::uuid, r.owner_id,
    encode(sha256(convert_to(
      'proof:' || (v#>>'{variants,proof,sha256}') || ':' || (v#>>'{variants,proof,bytes}') || ':' || (v#>>'{variants,proof,width}') || ':' || (v#>>'{variants,proof,height}') ||
      '|phone:' || (v#>>'{variants,phone,sha256}') || ':' || (v#>>'{variants,phone,bytes}') || ':' || (v#>>'{variants,phone,width}') || ':' || (v#>>'{variants,phone,height}') ||
      '|full:' || (v#>>'{variants,full,sha256}') || ':' || (v#>>'{variants,full,bytes}') || ':' || (v#>>'{variants,full,width}') || ':' || (v#>>'{variants,full,height}'), 'UTF8')), 'hex'),
    CASE WHEN v->>'ready' = 'true' THEN (v#>>'{variants,proof,bytes}')::bigint + (v#>>'{variants,phone,bytes}')::bigint + (v#>>'{variants,full,bytes}')::bigint ELSE 94371840 END,
    v->>'ready' = 'true'
  FROM public.delivery_rooms r, jsonb_array_elements(r.state->'photos') p, jsonb_array_elements(p->'versions') v;
UPDATE public.delivery_owner_limits o SET reserved_bytes = b.bytes, reserved_objects = b.objects
  FROM (SELECT owner_id, sum(charged_bytes) AS bytes, count(*) * 3 AS objects FROM public.delivery_upload_budget GROUP BY owner_id) b
  WHERE o.owner_id = b.owner_id;
--> statement-breakpoint
ALTER TABLE public.delivery_owner_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_upload_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_verification_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_safety_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_owner_limits, public.delivery_upload_budget, public.delivery_verification_slots, public.delivery_safety_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.delivery_owner_limits, public.delivery_upload_budget, public.delivery_verification_slots, public.delivery_safety_events TO service_role;
--> statement-breakpoint
-- Admission happens before ANY write ticket. Pending objects are charged at the bucket's
-- real ceiling, not untrusted declared byte lengths. Failed/lost responses do not refund.
CREATE FUNCTION public.delivery_reserve_upload(p_owner uuid, p_gallery uuid, p_version uuid, p_fingerprint text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE budget public.delivery_owner_limits; reservation public.delivery_upload_budget;
BEGIN
  SELECT * INTO budget FROM public.delivery_owner_limits WHERE owner_id = p_owner FOR UPDATE;
  IF NOT FOUND OR NOT budget.enabled THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.delivery_rooms WHERE id = p_gallery AND owner_id = p_owner) THEN RETURN false; END IF;
  SELECT * INTO reservation FROM public.delivery_upload_budget WHERE gallery_id = p_gallery AND version_id = p_version;
  IF FOUND THEN RETURN reservation.owner_id = p_owner AND reservation.fingerprint = p_fingerprint; END IF;
  IF budget.reserved_bytes + 94371840 > budget.byte_limit OR budget.reserved_objects + 3 > budget.object_limit THEN RETURN false; END IF;
  INSERT INTO public.delivery_upload_budget(gallery_id, version_id, owner_id, fingerprint) VALUES (p_gallery, p_version, p_owner, p_fingerprint);
  UPDATE public.delivery_owner_limits SET reserved_bytes = reserved_bytes + 94371840, reserved_objects = reserved_objects + 3 WHERE owner_id = p_owner;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.delivery_settle_upload(p_owner uuid, p_gallery uuid, p_version uuid, p_bytes bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE reservation public.delivery_upload_budget;
BEGIN
  PERFORM 1 FROM public.delivery_owner_limits WHERE owner_id = p_owner FOR UPDATE;
  SELECT * INTO reservation FROM public.delivery_upload_budget WHERE gallery_id = p_gallery AND version_id = p_version AND owner_id = p_owner FOR UPDATE;
  IF NOT FOUND OR p_bytes < 3 OR p_bytes > 94371840 THEN RETURN false; END IF;
  IF reservation.settled THEN RETURN reservation.charged_bytes = p_bytes; END IF;
  -- Only a committed, verified immutable version may release its pending-byte headroom.
  IF NOT EXISTS (SELECT 1 FROM public.delivery_rooms r, jsonb_array_elements(r.state->'photos') p, jsonb_array_elements(p->'versions') v
    WHERE r.id = p_gallery AND r.owner_id = p_owner AND v->>'id' = p_version::text AND v->>'ready' = 'true') THEN RETURN false; END IF;
  UPDATE public.delivery_owner_limits SET reserved_bytes = reserved_bytes - reservation.charged_bytes + p_bytes WHERE owner_id = p_owner;
  UPDATE public.delivery_upload_budget SET charged_bytes = p_bytes, settled = true WHERE gallery_id = p_gallery AND version_id = p_version;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.delivery_acquire_verification(p_owner uuid, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE free_slot smallint;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(8125401515);
  IF EXISTS (SELECT 1 FROM public.delivery_verification_slots WHERE owner_id = p_owner AND expires_at > clock_timestamp()) THEN RETURN false; END IF;
  SELECT slot INTO free_slot FROM public.delivery_verification_slots WHERE expires_at IS NULL OR expires_at <= clock_timestamp() ORDER BY slot LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.delivery_verification_slots SET owner_id = p_owner, lease_token = p_token, expires_at = clock_timestamp() + interval '90 seconds' WHERE slot = free_slot;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.delivery_release_verification(p_owner uuid, p_token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.delivery_verification_slots SET owner_id = NULL, lease_token = NULL, expires_at = NULL WHERE owner_id = p_owner AND lease_token = p_token;
$$;
--> statement-breakpoint
CREATE FUNCTION public.delivery_commit_verified(p_owner uuid, p_gallery uuid, p_revision integer, p_state jsonb, p_token uuid)
RETURNS SETOF public.delivery_rooms LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lease public.delivery_verification_slots; room public.delivery_rooms;
BEGIN
  SELECT * INTO lease FROM public.delivery_verification_slots WHERE owner_id = p_owner AND lease_token = p_token FOR UPDATE;
  IF NOT FOUND OR lease.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Verification lease expired'; END IF;
  SELECT * INTO room FROM public.delivery_rooms WHERE id = p_gallery AND owner_id = p_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery unavailable'; END IF;
  IF lease.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Verification lease expired'; END IF;
  IF room.revision <> p_revision THEN RETURN; END IF;
  IF octet_length(p_state::text) > 4194304 THEN RAISE EXCEPTION 'Delivery metadata budget reached'; END IF;
  RETURN QUERY UPDATE public.delivery_rooms SET state = p_state, revision = revision + 1, updated_at = now() WHERE id = p_gallery RETURNING *;
END;
$$;
--> statement-breakpoint
-- Closing cannot be blocked by a full JSON activity log or byte budget. Audit is separate.
CREATE FUNCTION public.delivery_close_room(p_owner uuid, p_gallery uuid, p_revision integer, p_operation uuid)
RETURNS SETOF public.delivery_rooms LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE room public.delivery_rooms; previous public.delivery_safety_events;
BEGIN
  SELECT * INTO room FROM public.delivery_rooms WHERE id = p_gallery AND owner_id = p_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery unavailable'; END IF;
  SELECT * INTO previous FROM public.delivery_safety_events WHERE owner_id = p_owner AND operation_id = p_operation;
  IF FOUND THEN
    IF previous.gallery_id <> p_gallery THEN RAISE EXCEPTION 'Operation ID conflict'; END IF;
    RETURN NEXT room; RETURN;
  END IF;
  IF room.revision <> p_revision THEN RAISE EXCEPTION 'Gallery changed; refresh before closing'; END IF;
  INSERT INTO public.delivery_safety_events(owner_id, operation_id, gallery_id) VALUES (p_owner, p_operation, p_gallery);
  RETURN QUERY UPDATE public.delivery_rooms SET state = jsonb_set(state, '{status}', '"closed"'), invitation_hash = NULL,
    revision = revision + 1, updated_at = now() WHERE id = p_gallery RETURNING *;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.delivery_reserve_upload(uuid, uuid, uuid, text), public.delivery_settle_upload(uuid, uuid, uuid, bigint), public.delivery_acquire_verification(uuid, uuid), public.delivery_release_verification(uuid, uuid), public.delivery_close_room(uuid, uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_reserve_upload(uuid, uuid, uuid, text), public.delivery_settle_upload(uuid, uuid, uuid, bigint), public.delivery_acquire_verification(uuid, uuid), public.delivery_release_verification(uuid, uuid), public.delivery_close_room(uuid, uuid, integer, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.delivery_commit_verified(uuid, uuid, integer, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_commit_verified(uuid, uuid, integer, jsonb, uuid) TO service_role;
