/** Built-in pose boards and per-shoot Pinterest links. No OAuth, no scrape. */

export const POSE_BOARDS = [
  { id: "standing", title: "Standing" },
  { id: "walk", title: "Walk" },
  { id: "sit", title: "Sit" },
  { id: "couple", title: "Couple" },
  { id: "sun", title: "Hard sun" },
  { id: "park", title: "Park" },
] as const;

export type PoseBoardId = (typeof POSE_BOARDS)[number]["id"];

export const POSES: { id: string; board: PoseBoardId; title: string; tall?: boolean }[] = [
  { id: "st-1", board: "standing", title: "Weight on the back foot" },
  { id: "st-2", board: "standing", title: "Shoulder to camera, far hip out", tall: true },
  { id: "st-3", board: "standing", title: "Lean, ankle crossed" },
  { id: "st-4", board: "standing", title: "Hands in pockets, elbows soft" },
  { id: "wk-1", board: "walk", title: "Walk toward camera on three" },
  { id: "wk-2", board: "walk", title: "Look back over the near shoulder", tall: true },
  { id: "wk-3", board: "walk", title: "Slow pass, hands unposed" },
  { id: "si-1", board: "sit", title: "One hip down, knees together" },
  { id: "si-2", board: "sit", title: "Knees up, arms around shins", tall: true },
  { id: "si-3", board: "sit", title: "Ledge sit, spine long" },
  { id: "cp-1", board: "couple", title: "Forehead to forehead" },
  { id: "cp-2", board: "couple", title: "One walks, one waits", tall: true },
  { id: "cp-3", board: "couple", title: "Hands in each other’s coat" },
  { id: "cp-4", board: "couple", title: "Chin on her hair" },
  { id: "su-1", board: "sun", title: "Back to the sun, face in open shade" },
  { id: "su-2", board: "sun", title: "Building edge as a flag", tall: true },
  { id: "su-3", board: "sun", title: "Chin down into the light" },
  { id: "su-4", board: "sun", title: "Shoot through hair" },
  { id: "pk-1", board: "park", title: "Bridge rail, one hand" },
  { id: "pk-2", board: "park", title: "Steps, sit two up" },
  { id: "pk-3", board: "park", title: "Walk the center line", tall: true },
  { id: "pk-4", board: "park", title: "High side of the rock" },
  { id: "pk-5", board: "park", title: "Lamp post, far foot hooked" },
];

export type ShootPoseLink = {
  pinterest: string;
  boards: PoseBoardId[];
};

const BOARD_IDS = new Set<string>(POSE_BOARDS.map((board) => board.id));

export function isPoseBoardId(value: string): value is PoseBoardId {
  return BOARD_IDS.has(value);
}

export function parsePinterestBoard(input: string): { href: string; label: string } | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 300) return null;
  let href = trimmed;
  if (!/^https?:\/\//i.test(href)) href = `https://${href.replace(/^\/+/, "")}`;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:"))
    return null;
  if (host === "pin.it") {
    const code = url.pathname.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
    if (!code || code.includes("/") || !/^[A-Za-z0-9_-]{4,24}$/.test(code)) return null;
    return { href: `https://pin.it/${code}`, label: "Pinterest" };
  }
  if (host !== "pinterest.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] === "pin") return null;
  const user = parts[0]!;
  const board = parts[1]!;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(user) || !/^[A-Za-z0-9_-]{1,80}$/.test(board)) return null;
  const label = board.replace(/-/g, " ");
  return { href: `https://www.pinterest.com/${user}/${board}/`, label };
}

function storageKey(scope: string) {
  return `celinen.poses.links.v1:${scope}`;
}

export function readShootPoseLinks(scope: string): Record<string, ShootPoseLink> {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, ShootPoseLink> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!id || id.length > 80 || !value || typeof value !== "object") continue;
      const row = value as { pinterest?: unknown; boards?: unknown };
      const pinterest = typeof row.pinterest === "string" ? row.pinterest.slice(0, 300) : "";
      const boards = Array.isArray(row.boards)
        ? row.boards.filter((item): item is PoseBoardId => typeof item === "string" && isPoseBoardId(item))
        : [];
      if (!pinterest && !boards.length) continue;
      out[id] = { pinterest, boards: [...new Set(boards)] };
    }
    return out;
  } catch {
    return {};
  }
}

export function writeShootPoseLinks(scope: string, links: Record<string, ShootPoseLink>) {
  const clean: Record<string, ShootPoseLink> = {};
  for (const [id, row] of Object.entries(links)) {
    if (!id || id.length > 80) continue;
    const pinterest = row.pinterest.trim().slice(0, 300);
    const boards = [...new Set(row.boards.filter(isPoseBoardId))];
    if (!pinterest && !boards.length) continue;
    clean[id] = { pinterest, boards };
  }
  localStorage.setItem(storageKey(scope), JSON.stringify(clean));
}
