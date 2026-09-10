import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { consentFromCookie } from "@/lib/marketing-consent";

const PATH = /^\/[A-Za-z0-9/_-]{0,180}$/;

export function trafficLogPath(): string {
  return process.env["FOTO_TRAFFIC_LOG"] ?? join(homedir(), ".foto", "marketing-events.jsonl");
}

export async function recordMarketingVisit(input: {
  cookie: string | null | undefined;
  path: string;
  referrer?: string;
}): Promise<{ recorded: boolean }> {
  if (consentFromCookie(input.cookie) !== "accepted") return { recorded: false };
  const path = input.path.trim();
  if (!PATH.test(path)) return { recorded: false };
  const referrer = (input.referrer ?? "").trim().slice(0, 300);
  const file = trafficLogPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(
    file,
    `${JSON.stringify({ at: new Date().toISOString(), path, referrer: referrer || null })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return { recorded: true };
}
