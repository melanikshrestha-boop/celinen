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
import { assembleAssistantMessages } from "../src/lib/assistant/orchestrator";
import { fastTalk } from "../src/lib/assistant/talk";

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
        expect(body.model).toBe("@cf/meta/llama-3.1-8b-instruct-fast");
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

describe("production Workers AI binding", () => {
  test("production build includes AI and preserves the native service binding", () => {
    const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(config).toMatch(/ai:\s*\{\s*binding:\s*"AI"\s*\}/);
    expect(config).toContain('binding: "CANONICAL_V2", service: "lenslab-canonical-v2-private"');
    expect(config).toContain("keep_vars: true");
  });
  test("production missing AI binding fails closed even with REST credentials configured", async () => {
    const source = readFileSync(
      new URL("../src/lib/cloudflare-ai.server.ts", import.meta.url),
      "utf8",
    )
      .replace('import("cloudflare:workers")', "Promise.resolve({ env: fixtureEnv })")
      .replaceAll("export ", "");
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
    const request = new Function("fixtureEnv", `${code}; return requestCloudflareChat;`)({
      CLOUDFLARE_AI_ENABLED: "true",
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      CLOUDFLARE_AI_API_TOKEN: "synthetic-secret",
    });
    let restCalls = 0;
    const logs: unknown[] = [];
    const result = await request(
      { messages: [] },
      undefined,
      async () => {
        restCalls++;
      },
      (entry: unknown) => logs.push(entry),
    );
    expect(result.status).toBe(503);
    expect(restCalls).toBe(0);
    expect(logs[0]).toMatchObject({ transport: "binding", category: "missing_binding" });
  });
  test("native binding needs no REST secret and normalizes its reply", async () => {
    let calls = 0;
    const result = await requestCloudflareChat(
      { messages: [{ role: "user", content: "hi" }] },
      {
        CLOUDFLARE_AI_ENABLED: "true",
        AI: {
          run: async (model, input, options) => {
            calls++;
            expect(model).toBe("@cf/meta/llama-3.1-8b-instruct-fast");
            expect(input.messages).toEqual([{ role: "user", content: "hi" }]);
            expect(options.returnRawResponse).toBe(true);
            expect(options.signal).toBeInstanceOf(AbortSignal);
            return Response.json({ response: "Hello!" });
          },
        },
      },
      (async () => {
        throw Error("REST must not be called");
      }) as typeof fetch,
    );
    expect(calls).toBe(1);
    expect(result.status).toBe(200);
    expect((await result.json()).choices[0].message.content).toBe("Hello!");
    expect(result.headers.get("x-chat-request-id")).toBeTruthy();
  });

  test("normalizes native tool proposals, without executing them", async () => {
    const result = await requestCloudflareChat(
      {
        messages: [{ role: "user", content: "show keepers" }],
        tools: [
          { type: "function", function: { name: "set_filter", parameters: { type: "object" } } },
        ],
      },
      {
        CLOUDFLARE_AI_ENABLED: "true",
        AI: {
          run: async (_model, input) => {
            expect(input.tools).toEqual([{ name: "set_filter", parameters: { type: "object" } }]);
            return Response.json({
              tool_calls: [{ name: "set_filter", arguments: { filter: "keepers" } }],
            });
          },
        },
      },
    );
    expect(result.status).toBe(200);
    const call = (await result.json()).choices[0].message.tool_calls[0];
    expect(call.function).toEqual({ name: "set_filter", arguments: '{"filter":"keepers"}' });
    expect(call.id).toBeTruthy();
    expect(call.type).toBe("function");
  });

  test("logs retired-model status/code without leaking input or secrets", async () => {
    const entries: unknown[] = [];
    const result = await requestCloudflareChat(
      { messages: [{ role: "user", content: "private client caption" }] },
      {
        CLOUDFLARE_AI_ENABLED: "true",
        AI: {
          run: async () =>
            Response.json(
              {
                errors: [
                  {
                    code: 5028,
                    message: "Model deprecated private client caption synthetic-secret",
                  },
                ],
              },
              { status: 410 },
            ),
        },
      },
      fetch,
      (entry) => entries.push(entry),
    );
    expect(result.status).toBe(502);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: "model_unavailable",
      upstream_status: 410,
      provider_code: 5028,
    });
    expect(JSON.stringify(entries)).not.toContain("private client caption");
    expect(JSON.stringify(entries)).not.toContain("synthetic-secret");
  });

  test("binding failures are categorized and never fall back to REST", async () => {
    for (const [status, category] of [
      [403, "provider_authorization"],
      [429, "rate_limit"],
      [422, "provider_schema"],
      [500, "provider_error"],
    ] as const) {
      let restCalls = 0;
      const logs: unknown[] = [];
      const result = await requestCloudflareChat(
        { messages: [] },
        {
          CLOUDFLARE_AI_ENABLED: "true",
          CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
          CLOUDFLARE_AI_API_TOKEN: "synthetic-secret",
          AI: { run: async () => new Response("private text must not leak", { status }) },
        },
        (async () => {
          restCalls++;
          throw Error("No fallback");
        }) as typeof fetch,
        (entry) => logs.push(entry),
      );
      expect(result.status).toBe(status === 429 ? 429 : 502);
      expect(restCalls).toBe(0);
      expect(logs[0]).toMatchObject({ category, upstream_status: status });
      expect(JSON.stringify(logs)).not.toContain("private text");
      expect(await result.text()).not.toContain("private text");
    }
  });

  test("invalid native responses fail closed with correlation IDs", async () => {
    for (const body of [
      "not-json",
      "{}",
      JSON.stringify({ response: "a".repeat(65536) }),
      JSON.stringify({ tool_calls: [{ name: "set_filter", arguments: "not-json" }] }),
    ]) {
      const logs: unknown[] = [];
      const result = await requestCloudflareChat(
        { messages: [] },
        {
          CLOUDFLARE_AI_ENABLED: "true",
          AI: { run: async () => new Response(body) },
        },
        fetch,
        (entry) => logs.push(entry),
      );
      expect(result.status).toBe(502);
      expect(logs[0]).toMatchObject({
        category: "invalid_response",
        request_id: result.headers.get("x-chat-request-id"),
      });
      expect(result.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("timeouts and binding exceptions are distinguished; logging failures do not break chat", async () => {
    for (const [error, category] of [
      [new DOMException("private prompt", "TimeoutError"), "timeout"],
      [Error("synthetic-secret"), "network_or_binding_error"],
    ] as const) {
      const logs: unknown[] = [];
      const result = await requestCloudflareChat(
        { messages: [] },
        {
          CLOUDFLARE_AI_ENABLED: "true",
          AI: {
            run: async () => {
              throw error;
            },
          },
        },
        fetch,
        (entry) => logs.push(entry),
      );
      expect(result.status).toBe(502);
      expect(logs[0]).toMatchObject({ category });
      expect(JSON.stringify(logs)).not.toContain(error.message);
    }
    const result = await requestCloudflareChat(
      { messages: [] },
      {
        CLOUDFLARE_AI_ENABLED: "true",
        AI: { run: async () => Response.json({ response: "Hello" }) },
      },
      fetch,
      () => {
        throw Error("logger unavailable");
      },
    );
    expect(result.status).toBe(200);
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
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("If I had to choose");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("Both are good depending on your preference");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("You are Lenslab");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("Never introduce yourself unless asked");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("not a rapper");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("finish it in one breath");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("Cursor for photographers");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).toContain("favorite song");
    expect(PHOTOGRAPHY_ASSISTANT_POLICY).not.toContain(
      "I'm here to help with any questions related to photography",
    );
  });
  test("lyrics and half-lines are conversation, not cull commands", () => {
    expect(isPhotographyConversation("Olá, come with us")).toBe(true);
    expect(isPhotographyConversation("come with us")).toBe(true);
    expect(isPhotographyConversation("cull this shoot")).toBe(false);
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
    assembleAssistantMessages,
    fastTalk,
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
  upstreamFailure = Response.json(
    { error: "Cloudflare AI is not configured yet." },
    { status: 503, headers: { "x-chat-request-id": "synthetic-request-id" } },
  );
  const unavailable = await route.server.handlers.POST({ request: request(true, "conversation") });
  expect(unavailable.status).toBe(503);
  expect(unavailable.headers.get("x-chat-request-id")).toBe("synthetic-request-id");
  expect(unavailable.headers.get("cache-control")).toBe("no-store");
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
