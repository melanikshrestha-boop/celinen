import { fotoArticles } from "@/lib/public-content";
import { buildSocialPost, composeAction, POST_LENGTHS, POST_TONES } from "@/lib/social-post";
import { SOCIAL_NETWORKS, type SocialId } from "@/lib/social-accounts";

export const FOTO_MCP_URL = "https://lenslab.dev/api/mcp";
export const FOTO_MCP_PROTOCOL = "2025-03-26";

const PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export const FOTO_MCP_TOOLS = [
  {
    name: "foto_workflow",
    description:
      "The working path: import a shoot, pick keepers, finish in the photographer’s editor, send a gallery. Originals stay local unless they publish.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "foto_plans",
    description: "Published plan names and monthly amounts in USD. Not a quote.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "foto_articles",
    description: "Public photography notes on the blog: titles, slugs, and categories.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Optional blog category filter." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "celinen_draft_post",
    description:
      "Turn a shoot idea into a caption the photographer can edit, then post from connected accounts. Does not publish. Does not claim a live post landed.",
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "What the photographer wants to post." },
        tone: { type: "string", enum: [...POST_TONES] },
        length: { type: "string", enum: [...POST_LENGTHS] },
        hashtags: { type: "boolean" },
        network: {
          type: "string",
          description:
            "Optional network id for a length-clipped variant (x, instagram, threads, …).",
        },
      },
      required: ["idea"],
      additionalProperties: false,
    },
  },
  {
    name: "celinen_open",
    description:
      "Return the in-app URL for Pick, Galleries, Develop, Social, Analytics, or Calendar.",
    inputSchema: {
      type: "object",
      properties: {
        desk: {
          type: "string",
          enum: ["pick", "galleries", "develop", "social", "analytics", "calendar", "home"],
        },
      },
      required: ["desk"],
      additionalProperties: false,
    },
  },
  {
    name: "celinen_networks",
    description:
      "Networks a photographer can associate, then post after editing. Encrypted login first. No live OAuth posting from this tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS, DELETE",
    "access-control-allow-headers":
      "content-type, accept, authorization, mcp-protocol-version, mcp-session-id",
    "cache-control": "no-store",
  };
}

function encode(body: unknown, request: Request, status = 200) {
  const accept = request.headers.get("accept") ?? "";
  const payload = JSON.stringify(body);
  const sse = accept.includes("text/event-stream") && !accept.includes("application/json");
  if (sse) {
    return new Response(`event: message\ndata: ${payload}\n\n`, {
      status,
      headers: { ...cors(), "content-type": "text/event-stream" },
    });
  }
  return new Response(payload, {
    status,
    headers: { ...cors(), "content-type": "application/json" },
  });
}

function ok(id: Rpc["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function fail(id: Rpc["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

const DESKS: Record<string, { path: string; label: string }> = {
  home: { path: "/dashboard", label: "Chat" },
  pick: { path: "/studio", label: "Pick" },
  galleries: { path: "/deliver", label: "Galleries" },
  develop: { path: "/develop", label: "Develop" },
  social: { path: "/publish", label: "Social accounts" },
  analytics: { path: "/earnings", label: "Analytics" },
  calendar: { path: "/dashboard?view=calendar", label: "Calendar" },
};

function toolText(name: string, args: Record<string, unknown>) {
  if (name === "foto_workflow") {
    return [
      "Import the card. Pick keepers. Finish in Lightroom or Capture One. Send a gallery copy.",
      "Then draft a social post on /publish, edit it, and open compose on a connected account.",
      "Rejects are flags, not deletes. Originals stay on the machine unless the photographer publishes.",
    ].join(" ");
  }
  if (name === "foto_plans") {
    return [
      "Hobby is USD 20 / month with 1,000 photo credits, pick, gallery, and roster tags.",
      "Creator is USD 30 / month with 5,000 photo credits, Adobe, REST API, and MCP.",
      "Arena is USD 200 / month with 25,000 photo credits, Adobe, REST API, and MCP.",
      "Enterprise is custom.",
      "Confirm the amount at checkout before you pay.",
    ].join(" ");
  }
  if (name === "foto_articles") {
    const category = typeof args.category === "string" ? args.category.trim() : "";
    const rows = fotoArticles.filter(
      (article) => !article.draft && (!category || article.category === category),
    );
    if (!rows.length) return "No public notes in that category.";
    return rows
      .map((article) => `${article.title} — /blog/${article.slug} (${article.category})`)
      .join("\n");
  }
  if (name === "celinen_draft_post") {
    const idea = typeof args.idea === "string" ? args.idea.trim() : "";
    if (!idea) return "Give an idea for the post.";
    const tone = POST_TONES.find((item) => item === args.tone) ?? "Professional";
    const length = POST_LENGTHS.find((item) => item === args.length) ?? "Medium";
    const post = buildSocialPost({
      idea,
      tone,
      length,
      hashtags: args.hashtags !== false,
    });
    const network = typeof args.network === "string" ? args.network : "";
    const action = SOCIAL_NETWORKS.some((item) => item.id === network)
      ? composeAction(network as SocialId, post.caption)
      : null;
    return [
      post.caption,
      action?.href ? `Compose: ${action.href}` : "",
      "This is a draft. The photographer edits it, then posts from a connected account. Nothing was published.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (name === "celinen_open") {
    const desk = typeof args.desk === "string" ? args.desk : "";
    const match = DESKS[desk];
    if (!match) return "Choose pick, galleries, develop, social, analytics, calendar, or home.";
    return `${match.label}: https://lenslab.dev${match.path}`;
  }
  if (name === "celinen_networks") {
    return [
      "Associate an account first (encrypted, on device). Then draft, edit, and open compose.",
      "We do not post through a live API from this connector.",
      SOCIAL_NETWORKS.map((item) => `${item.id} — ${item.title} (${item.kind})`).join("\n"),
    ].join("\n");
  }
  return "";
}

export function fotoMcpInitialize(protocolVersion?: string) {
  const version =
    protocolVersion && PROTOCOLS.has(protocolVersion) ? protocolVersion : FOTO_MCP_PROTOCOL;
  return {
    protocolVersion: version,
    capabilities: { tools: {} },
    serverInfo: { name: "foto", version: "1.0.0" },
    instructions:
      "Photography tools for FOTO. Originals stay local unless the photographer publishes a gallery copy.",
  };
}

export function fotoMcpRpc(message: Rpc) {
  const method = message.method ?? "";
  const id = message.id;
  const params = message.params ?? {};
  if (method === "initialize") {
    const protocolVersion =
      typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    return ok(id, fotoMcpInitialize(protocolVersion));
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: FOTO_MCP_TOOLS });
  if (method === "resources/list") return ok(id, { resources: [] });
  if (method === "prompts/list") return ok(id, { prompts: [] });
  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};
    const text = toolText(name, args);
    if (!text) return fail(id, -32602, `Unknown tool: ${name || "(missing)"}`);
    return ok(id, { content: [{ type: "text", text }] });
  }
  if (!method) return fail(id, -32600, "Invalid request");
  return fail(id, -32601, `Method not found: ${method}`);
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (request.method === "GET") {
    return encode(
      {
        name: "foto",
        protocol: FOTO_MCP_PROTOCOL,
        url: FOTO_MCP_URL,
        tools: FOTO_MCP_TOOLS.map((t) => t.name),
      },
      request,
    );
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors() });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return encode(fail(null, -32700, "Parse error"), request, 400);
  }
  if (Array.isArray(body)) {
    const results = body
      .map((item) => fotoMcpRpc(item as Rpc))
      .filter((item): item is NonNullable<ReturnType<typeof fotoMcpRpc>> => item !== null);
    return encode(results, request);
  }
  const result = fotoMcpRpc((body ?? {}) as Rpc);
  if (result === null) return new Response(null, { status: 202, headers: cors() });
  return encode(result, request);
}
