import { businessDatabase } from "../business/database.server";
import {
  emptyShop,
  shopSchema,
  photographerSchema,
  type Shop,
  type Photographer,
  type Inquiry,
  type DirectoryEntry,
} from "./model";
type DB = ReturnType<typeof businessDatabase>;
const unavailable =
  "Commerce is not connected yet. Your draft is still here. The LensLabs owner needs to activate the commerce database.";
export async function readShop(owner: string, db: DB = businessDatabase()) {
  const { data, error } = await db
    .from("commerce_shops")
    .select("state")
    .eq("owner_id", owner)
    .maybeSingle();
  if (error) throw new Error(unavailable);
  return shopSchema.parse(data?.state ?? emptyShop());
}
export async function saveShop(owner: string, state: Shop, db: DB = businessDatabase()) {
  const parsed = shopSchema.parse(state);
  const { data, error } = await db.rpc("commerce_save_shop", {
    p_owner: owner,
    p_state: parsed,
    p_revision: parsed.revision,
  });
  if (error)
    throw new Error(
      "The shop changed elsewhere or could not be saved. Your draft is preserved. Reload saved data before retrying.",
    );
  return shopSchema.parse(data);
}
export async function readNetwork(owner: string, db: DB = businessDatabase()) {
  const [profile, incoming, outgoing] = await Promise.all([
    db
      .from("photographer_directory")
      .select("profile,revision")
      .eq("owner_id", owner)
      .maybeSingle(),
    db
      .from("photographer_inquiries")
      .select("*")
      .eq("recipient", owner)
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("photographer_inquiries")
      .select("*")
      .eq("sender", owner)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (profile.error || incoming.error || outgoing.error) throw new Error(unavailable);
  const map = (row: Record<string, unknown>): Inquiry => ({
    id: String(row["id"]),
    sender: String(row["sender"]),
    recipient: String(row["recipient"]),
    senderName: String(row["sender_name"]),
    recipientName: String(row["recipient_name"]),
    kind: row["kind"] as Inquiry["kind"],
    message: String(row["message"]),
    status: row["status"] as Inquiry["status"],
    createdAt: String(row["created_at"]),
  });
  return {
    profile: profile.data ? photographerSchema.parse(profile.data.profile) : null,
    revision: Number(profile.data?.revision ?? 0),
    incoming: incoming.data!.map(map),
    outgoing: outgoing.data!.map(map),
  };
}
export async function saveProfile(
  owner: string,
  profile: Photographer,
  revision: number,
  db: DB = businessDatabase(),
) {
  const { data, error } = await db.rpc("directory_save_profile", {
    p_owner: owner,
    p_profile: photographerSchema.parse(profile),
    p_revision: revision,
  });
  if (error || typeof data !== "number")
    throw new Error(
      "Your profile changed elsewhere or could not be saved. Your draft is preserved. Reload saved data before retrying.",
    );
  return { profile, revision: data };
}
/** Read only the identity the creator explicitly chose to publish, never their account profile. */
export async function publicPhotographer(owner: string, db: DB = businessDatabase()) {
  const { data, error } = await db
    .from("photographer_directory")
    .select("owner_id,profile,visible")
    .eq("owner_id", owner)
    .eq("visible", true)
    .maybeSingle();
  if (error) throw new Error("This creator’s public profile is temporarily unavailable.");
  const profile = photographerSchema.safeParse(data?.profile);
  if (
    !data ||
    data.owner_id !== owner ||
    data.visible !== true ||
    !profile.success ||
    !profile.data.visible
  )
    return null;
  return { ...profile.data, owner };
}

export async function discover(
  query: string,
  offset: number,
  db: DB = businessDatabase(),
): Promise<DirectoryEntry[]> {
  const { data, error } = await db.rpc("directory_discover", { p_query: query, p_offset: offset });
  if (error)
    throw new Error("The photographer directory is not available yet. Please try again later.");
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...photographerSchema.parse(row["profile"]),
    owner: String(row["owner"]),
    reviewCount: Number(row["review_count"]),
    rating: row["rating"] === null ? null : Number(row["rating"]),
    score: Number(row["score"]),
  }));
}
export async function respond(
  owner: string,
  id: string,
  status: "accepted" | "declined" | "withdrawn",
  db: DB = businessDatabase(),
) {
  // Only the recipient can accept/decline; only the sender can withdraw. Terminal states cannot be overwritten.
  const { data, error } = await db
    .from("photographer_inquiries")
    .update({ status })
    .eq("id", id)
    .eq(status === "withdrawn" ? "sender" : "recipient", owner)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error || !data)
    throw new Error("This request changed or is no longer available. Refresh your inbox.");
  return { id, status };
}
