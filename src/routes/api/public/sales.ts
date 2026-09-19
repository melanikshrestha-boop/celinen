import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import {
  normalizeSalesInquiry,
  validateSalesInquiry,
  type SalesInquiryDraft,
} from "@/lib/sales-inquiry";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function salesLogPath(): string {
  return process.env["LENSLAB_SALES_LOG"] ?? join(homedir(), ".foto", "sales-inquiries.jsonl");
}

export async function handleSalesPost(request: Request): Promise<Response> {
  let body: SalesInquiryDraft;
  try {
    body = (await request.json()) as SalesInquiryDraft;
  } catch {
    return json({ error: "Could not read that form." }, 400);
  }
  if (typeof body.fax === "string" && body.fax.trim()) return json({ id: "ok" });
  const error = validateSalesInquiry(body);
  if (error) return json({ error }, 400);
  const inquiry = normalizeSalesInquiry(
    body,
    `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    const file = salesLogPath();
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await appendFile(file, `${JSON.stringify(inquiry)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    return json({ error: "Could not send." }, 503);
  }
  return json({ id: inquiry.id });
}

export const Route = createFileRoute("/api/public/sales")({
  server: {
    handlers: {
      POST: async ({ request }) => handleSalesPost(request),
    },
  },
});
