import { emptyShop, type Shop, type Photographer, type Inquiry } from "@/lib/commerce/model";
if (location.origin !== "http://127.0.0.1:8084")
  throw new Error("Isolated commerce QA origin only");
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const user = {
  id: owner,
  email: "qa@example.test",
  email_confirmed_at: "2026-09-01",
  app_metadata: {},
  user_metadata: {
    display_name: "Vincent van Gogh",
    full_name: "Vincent van Gogh",
    lenslabs_setup_version: 1,
    lenslabs_workspace_name: "QA only",
  },
};
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { user, access_token: "fixture" } } }),
    getUser: async () => ({ data: { user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
};
export const saveAccountProfile = async () => {
  throw new Error("Not part of commerce QA");
};
let shop: Shop = emptyShop(),
  profile: Photographer | null = null,
  revision = 0;
const person = {
  owner: other,
  displayName: "Asha Rai",
  city: "Kathmandu",
  country: "Nepal",
  languages: "नेपाली, English",
  bio: "Sports, movement and the people between frames.",
  specialties: ["Sports", "Editorial"],
  available: true,
  visible: true,
  reviewCount: 0,
  rating: null,
  score: 0,
};
let outgoing: Inquiry[] = [],
  incoming: Inquiry[] = [
    {
      id: crypto.randomUUID(),
      sender: other,
      recipient: owner,
      senderName: "Asha Rai",
      recipientName: "Vincent",
      kind: "collaboration",
      message: "Would you like to cover a football tournament together?",
      status: "pending",
      createdAt: new Date().toISOString(),
    },
  ];
export const qa = {
  failNext: false,
  delay: 40,
  saves: 0,
  sends: 0,
  errors: [] as string[],
  get shop() {
    return shop;
  },
  get profile() {
    return profile;
  },
  get outgoing() {
    return outgoing;
  },
  get incoming() {
    return incoming;
  },
};
Object.assign(window, { __commerceQA: qa });
window.addEventListener("error", (e) => qa.errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => qa.errors.push(String(e.reason)));
const wait = async () => {
  await new Promise((resolve) => setTimeout(resolve, qa.delay));
  if (qa.failNext) {
    qa.failNext = false;
    throw new Error("Test connection failed. Your draft is preserved.");
  }
};
export const getShop = async () => structuredClone(shop);
export const persistShop = async ({ data }: { data: { state: Shop; expectedOwner: string } }) => {
  qa.saves++;
  await wait();
  if (data.expectedOwner !== owner) throw new Error("Account changed");
  if (data.state.revision !== shop.revision) throw new Error("Shop changed elsewhere");
  shop = { ...structuredClone(data.state), revision: data.state.revision + 1 };
  return structuredClone(shop);
};
export const getNetwork = async () => ({
  profile: structuredClone(profile),
  revision,
  incoming: structuredClone(incoming),
  outgoing: structuredClone(outgoing),
});
export const persistPhotographer = async ({
  data,
}: {
  data: { profile: Photographer; revision: number };
}) => {
  qa.saves++;
  await wait();
  if (data.revision !== revision) throw new Error("Profile changed elsewhere");
  profile = structuredClone(data.profile);
  revision++;
  return { profile, revision };
};
export const findPhotographers = async ({ data }: { data: { query: string; offset: number } }) => {
  await new Promise((resolve) => setTimeout(resolve, qa.delay));
  return !data.offset && JSON.stringify(person).toLowerCase().includes(data.query.toLowerCase())
    ? [person]
    : [];
};
export const sendPhotographerRequest = async ({
  data,
}: {
  data: Pick<Inquiry, "id" | "recipient" | "kind" | "message">;
}) => {
  qa.sends++;
  await wait();
  if (!outgoing.some((i) => i.id === data.id))
    outgoing.push({
      ...data,
      sender: owner,
      senderName: "Vincent",
      recipientName: person.displayName,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  return { id: data.id };
};
export const respondToRequest = async ({
  data,
}: {
  data: { id: string; status: Inquiry["status"] };
}) => {
  await wait();
  incoming = incoming.map((r) => (r.id === data.id ? { ...r, status: data.status } : r));
  outgoing = outgoing.map((r) => (r.id === data.id ? { ...r, status: data.status } : r));
  return data;
};
