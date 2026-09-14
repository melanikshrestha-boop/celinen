import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assistantUnavailable,
  isPhotographyConversation,
  PHOTOGRAPHY_ASSISTANT_POLICY,
  requireAssistantMessage,
} from "../src/lib/photography-assistant";
import { studioCommandRefusal, studioToolBoundary } from "../src/lib/studio/command-safety";
import { parseLocalCommand } from "../src/lib/studio/commands";
import { requestCloudflareChat } from "../src/lib/cloudflare-ai.server";

describe("direct Cloudflare AI transport", () => {
  const config = {
    CLOUDFLARE_AI_ENABLED: "true",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_AI_API_TOKEN: "synthetic-secret",
  };
  test("disabled or missing credentials never sends", async () => {
    for (const env of [
      {},
      { ...config, CLOUDFLARE_AI_ENABLED: "false" },
      { ...config, CLOUDFLARE_AI_API_TOKEN: "" },
    ]) {
      let calls = 0;
      const result = await requestCloudflareChat({ messages: [] }, env, (async () => {
        calls++;
        throw Error("must not send");
      }) as typeof fetch);
      expect(result.status).toBe(503);
      expect(calls).toBe(0);
    }
  });
  test("uses only Cloudflare and caps output; preserves tool proposals", async () => {
    const result = await requestCloudflareChat(
      { messages: [{ role: "user", content: "hello" }], max_tokens: 9999 },
      config,
      (async (url, init) => {
        expect(String(url)).toBe(
          `https://api.cloudflare.com/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
        );
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-secret");
        const body = JSON.parse(String(init?.body));
        expect(body.max_tokens).toBe(2048);
        expect(body.model).toBe("@cf/meta/llama-3.1-8b-instruct");
        return Response.json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ function: { name: "cull", arguments: "{}" } }],
              },
            },
          ],
        });
      }) as typeof fetch,
    );
    expect(result.status).toBe(200);
  });
  test("provider errors and network exceptions never expose secrets", async () => {
    for (const status of [401, 403, 429, 500]) {
      const result = await requestCloudflareChat(
        { messages: [] },
        config,
        (async () => new Response("synthetic-secret", { status })) as typeof fetch,
      );
      expect(result.status).toBe(status === 429 ? 429 : 502);
      expect(await result.text()).not.toContain("synthetic-secret");
    }
    const result = await requestCloudflareChat({ messages: [] }, config, (async () => {
      throw Error("synthetic-secret");
    }) as typeof fetch);
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain("synthetic-secret");
  });
  test("empty and invalid JSON are failures", async () => {
    for (const payload of ["{}", "not-json"]) {
      const result = await requestCloudflareChat(
        { messages: [] },
        config,
        (async () => new Response(payload)) as typeof fetch,
      );
      expect(result.status).toBe(502);
    }
  });
});

describe("photographer conversation, not command fragments", () => {
  for (const text of [
    "Where can I shoot portraits tomorrow?",
    "Help me plan a football shoot if it rains",
    "How do I cull without losing the story?",
    "Brainstorm a warm cinematic portrait concept",
    "Write a client email before we book the space",
    "Reserve a studio for tomorrow",
    "What should I charge for this shoot?",
    "hello",
  ])
    test(text, () => expect(isPhotographyConversation(text)).toBe(true));
  for (const text of [
    "cull this shoot",
    "show keepers",
    "export keepers",
    "write xmp",
    "write sidecars",
    "make it warmer",
    "review bursts",
    "compare bursts",
    "apply",
    "discard",
  ])
    test(`retains explicit action: ${text}`, () =>
      expect(isPhotographyConversation(text)).toBe(false));

  test("exposes the original restriction failure without changing its safety boundary", () => {
    expect(studioCommandRefusal("Where can I shoot portraits tomorrow?")).toContain("restriction");
    expect(isPhotographyConversation("Where can I shoot portraits tomorrow?")).toBe(true);
    expect(parseLocalCommand("How do I cull?")?.calls[0]?.name).toBe("cull");
  });
  test("clear configuration errors, not a false unmatched-command reply", () => {
    expect(assistantUnavailable("disabled")).toContain("turned off");
    expect(assistantUnavailable("session")).toContain("Sign in again");
    expect(assistantUnavailable("local")).toContain("not connected");
  });
  test("empty provider responses are failures, never done", () => {
    for (const value of [null, undefined, {}, { content: " " }, { content: 7 }])
      expect(() => requireAssistantMessage(value)).toThrow("no reply");
    expect(requireAssistantMessage({ content: "Let's plan your shoot." }).content).toContain(
      "plan",
    );
  });
  test("policy allows brainstorming but never pretends to book or browse", () => {
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("does not require imported photographs");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("cannot reserve");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("Never invent citations");
  });
});

// Execute the real send callback with instance-local UI/auth/network doubles.
// No account, network, browser storage or customer photograph is used.
const source =
  process.env.CELINEN_CHAT_BASELINE === "1"
    ? (() => {
        const baseline = Bun.spawnSync(["git", "show", "HEAD:src/components/studio/CullChat.tsx"], {
          cwd: new URL("..", import.meta.url).pathname,
          stdout: "pipe",
          stderr: "pipe",
        });
        if (baseline.exitCode !== 0) throw new Error("Cannot load committed chat baseline");
        return new TextDecoder().decode(baseline.stdout);
      })()
    : readFileSync(new URL("../src/components/studio/CullChat.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const send = useCallback(");
const end = source.indexOf("\n  return (", start);
if (start < 0 || end < 0) throw new Error("Missing real send callback");
const callback = new Bun.Transpiler({ loader: "tsx" }).transformSync(
  source
    .slice(start, end)
    .replaceAll("import.meta.env", "fixtureEnv")
    .replace('import("@/integrations/supabase/client")', "Promise.resolve(fixtureSupabase)"),
);
function fixture(
  options: {
    importing?: boolean;
    disabled?: boolean;
    local?: boolean;
    reply?: unknown;
    session?: boolean;
  } = {},
) {
  let messages: Array<{ text: string }> = [];
  const requests: Array<Record<string, unknown>> = [];
  let actions = 0;
  const owner = "12345678-1234-4123-a123-123456789012";
  const noParse = () => null;
  const env = {
    useCallback: (fn: unknown) => fn,
    isPhotographyConversation,
    assistantUnavailable,
    requireAssistantMessage,
    studioCommandRefusal,
    studioToolBoundary,
    parseLocalCommand,
    parseAdobeSettingsPaste: noParse,
    parseWorkspaceRequest: noParse,
    parseClientCommand: noParse,
    workbenchNavigation: noParse,
    parseStudioWorkflowIntent: noParse,
    parseCreativeEdit: noParse,
    dispatchClientCommand: () => {
      actions++;
    },
    execute: async () => {
      actions++;
      return "preview ready: picks";
    },
    stageEdit: () => {
      actions++;
    },
    stageAdobeSettings: () => {
      actions++;
    },
    context: "No imported photos",
    frameCount: 0,
    onApply: undefined,
    onDiscard: undefined,
    proposalAction: () => {
      actions++;
    },
    onImportFolder: undefined,
    onWorkflow: undefined,
    onNavigate: undefined,
    onWorkspaceRequest: undefined,
    history: undefined,
    historyRef: { current: [] },
    sendingRef: { current: false },
    followsLatest: { current: true },
    lifecycle: { current: { active: true, controller: new AbortController() } },
    notificationPreferences: { current: {} },
    notifyResponseReady: () => {},
    inputRef: { current: null },
    setInput: () => {},
    setShowLatest: () => {},
    setThinking: () => {},
    setRunning: () => {},
    setMsgs: (fn: (prior: typeof messages) => typeof messages) => {
      messages = fn(messages);
    },
    importing: options.importing ?? false,
    paused: false,
    storageScope: owner,
    account: { preferences: { cloudAssistant: !options.disabled } },
    isLocalSingleUserMode: options.local ?? false,
    fixtureEnv: {
      VITE_SUPABASE_URL: "https://test.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "synthetic",
    },
    fixtureSupabase: {
      supabase: {
        auth: {
          getSession: async () => ({
            data: {
              session:
                options.session === false
                  ? null
                  : { user: { id: owner }, access_token: "synthetic-no-network" },
            },
          }),
        },
      },
    },
    assistantPersonalization: () => "",
    DEFAULT_PREFERENCES: {},
    PRODUCT_NAME: "celinen",
    STUDIO_TOOL_DEFINITIONS: [{ type: "function", function: { name: "cull" } }],
    fetch: async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return {
        ok: true,
        json: async () => ({
          message:
            options.reply === undefined ? { content: "Let's plan that shoot." } : options.reply,
        }),
      };
    },
  };
  const send = new Function(...Object.keys(env), `${callback}; return send;`)(
    ...Object.values(env),
  ) as (text: string) => Promise<void>;
  return { send, requests, messages: () => messages, actions: () => actions };
}
test("real chat sends a planning question to AI without tools or a photo requirement", async () => {
  const f = fixture();
  await f.send("Where can I shoot portraits tomorrow?");
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]!.mode).toBe("conversation");
  expect(f.requests[0]!.tools).toEqual([]);
  expect(f.messages().at(-1)!.text).toBe("Let's plan that shoot.");
  expect(f.actions()).toBe(0);
});
test("asking how to cull does not run a cull", async () => {
  const f = fixture();
  await f.send("How do I cull?");
  expect(f.requests).toHaveLength(1);
  expect(f.actions()).toBe(0);
});
test("conversation stays available during import; photo actions stay blocked", async () => {
  const f = fixture({ importing: true });
  await f.send("Help me plan tomorrow's shoot");
  await f.send("cull this shoot");
  expect(f.requests).toHaveLength(1);
  expect(f.actions()).toBe(0);
});
test("explicit local cull still proposes edits and stops for review", async () => {
  const f = fixture();
  await f.send("cull this shoot");
  expect(f.actions()).toBe(1);
  expect(f.requests).toHaveLength(0);
  expect(f.messages().at(-1)!.text).toContain("Review the proposal");
});
test("provider tool calls cannot execute during conversation", async () => {
  const f = fixture({
    reply: { tool_calls: [{ id: "x", function: { name: "cull", arguments: "{}" } }] },
  });
  await f.send("How do I cull?");
  expect(f.actions()).toBe(0);
  expect(f.messages().at(-1)!.text).toContain("Nothing was run");
});
test("empty provider reply never creates a success receipt", async () => {
  const f = fixture({ reply: null });
  await f.send("hello");
  expect(f.messages().at(-1)!.text).toContain("no reply");
});
for (const options of [{ disabled: true }, { local: true }, { session: false }])
  test(`unavailable AI makes no requests: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await f.send("Help me plan a shoot");
    expect(f.requests).toHaveLength(0);
    expect(f.messages().at(-1)!.text).not.toContain("match that locally");
    expect(f.actions()).toBe(0);
  });

test("actual server route removes tools in conversation mode and installs the photographer policy", async () => {
  const routeSource = readFileSync(new URL("../src/routes/api/chat.ts", import.meta.url), "utf8");
  const transformed = new Bun.Transpiler({ loader: "ts" }).transformSync(
    routeSource
      .replace(/^import .*;\n/gm, "")
      .replace("export const Route", "const Route")
      .replace('import("@supabase/supabase-js")', "Promise.resolve(fixtureAuth)")
      .replaceAll("process.env", "fixtureEnv"),
  );
  const sent: Array<{
    tools?: unknown;
    tool_choice?: unknown;
    messages: Array<{ content: string }>;
  }> = [];
  let upstreamFailure: Response | undefined;
  const env = {
    createFileRoute: () => (config: unknown) => config,
    requestCloudflareChat: async (input: Parameters<typeof requestCloudflareChat>[0]) => {
      sent.push(input as (typeof sent)[number]);
      if (upstreamFailure) return upstreamFailure;
      return Response.json({ choices: [{ message: { content: "Let's brainstorm." } }] });
    },
    PHOTOGRAPHY_ASSISTANT_POLICY,
    fixtureAuth: {
      createClient: () => ({
        auth: { getClaims: async () => ({ data: { claims: { sub: "synthetic-owner" } } }) },
      }),
    },
    fixtureEnv: {
      SUPABASE_URL: "https://test.invalid",
      SUPABASE_PUBLISHABLE_KEY: "synthetic",
    },
    fetch: async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ choices: [{ message: { content: "Let's brainstorm." } }] });
    },
  };
  const route = new Function(...Object.keys(env), `${transformed}; return Route;`)(
    ...Object.values(env),
  );
  const tools = [{ type: "function", function: { name: "cull" } }];
  const request = (auth: boolean, mode: string) =>
    new Request("https://test.invalid/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: "Bearer synthetic.test.token" } : {}),
      },
      body: JSON.stringify({ mode, messages: [{ role: "user", content: "Plan a shoot" }], tools }),
    });
  expect(
    (await route.server.handlers.POST({ request: request(false, "conversation") })).status,
  ).toBe(401);
  expect(sent).toHaveLength(0);
  expect(
    (await route.server.handlers.POST({ request: request(true, "conversation") })).status,
  ).toBe(200);
  expect(sent[0].tools).toBeUndefined();
  expect(sent[0].tool_choice).toBeUndefined();
  expect(sent[0].messages[0].content).toBe(PHOTOGRAPHY_ASSISTANT_POLICY);
  await route.server.handlers.POST({ request: request(true, "studio") });
  expect(sent[1].tools).toEqual(tools);
  upstreamFailure = Response.json({ error: "Cloudflare AI is not configured yet." }, { status: 503 });
  const unavailable = await route.server.handlers.POST({ request: request(true, "conversation") });
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ error: "Cloudflare AI is not configured yet." });
  env.fixtureAuth.createClient = () => ({
    auth: {
      getClaims: async () => {
        throw new Error("Malformed token");
      },
    },
  });
  expect(
    (await route.server.handlers.POST({ request: request(true, "conversation") })).status,
  ).toBe(401);
  expect(sent).toHaveLength(3);
});
