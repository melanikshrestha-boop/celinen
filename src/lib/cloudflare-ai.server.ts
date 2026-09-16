/** Hosted chat: Grok when XAI_API_KEY is set, else Workers AI. */
export const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const GROK_CHAT_MODEL = "grok-4.6";
type ChatInput = {
  messages: unknown[];
  tools?: unknown[];
  tool_choice?: string;
  max_tokens?: number;
  voice?: "human" | "fast";
};
type AiBinding = {
  run(
    model: string,
    input: Record<string, unknown>,
    options: { returnRawResponse: true; signal: AbortSignal },
  ): Promise<unknown>;
};
type ChatEnv = {
  AI?: AiBinding;
  CLOUDFLARE_AI_ENABLED?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_API_TOKEN?: string;
  XAI_API_KEY?: string;
};
type LogEntry = Record<string, string | number | null>;
type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};

async function boundedJson(response: Response): Promise<Json> {
  if (!response.body) throw new Error("invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) throw new Error("invalid_response");
      text += decoder.decode(value, { stream: true });
    }
    return object(JSON.parse(text + decoder.decode()));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function normalizeMessage(data: Json) {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const message = object(object(choices[0]).message);
  const content = message.content ?? data.response;
  const rawCalls = message.tool_calls ?? data.tool_calls;
  const calls = Array.isArray(rawCalls)
    ? rawCalls.map((raw) => {
        const call = object(raw),
          fn = object(call.function ?? call);
        if (typeof fn.name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(fn.name))
          throw Error("invalid_response");
        const args: unknown =
          typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
        if (!args || typeof args !== "object" || Array.isArray(args))
          throw Error("invalid_response");
        return {
          id: typeof call.id === "string" ? call.id : `call_${crypto.randomUUID()}`,
          type: "function",
          function: { name: fn.name, arguments: JSON.stringify(args) },
        };
      })
    : [];
  if (!(typeof content === "string" && content.trim()) && !calls.length)
    throw Error("invalid_response");
  return {
    role: "assistant",
    content: typeof content === "string" ? content : null,
    ...(calls.length ? { tool_calls: calls } : {}),
  };
}

export async function requestCloudflareChat(
  input: ChatInput,
  env?: ChatEnv,
  send: typeof fetch = fetch,
  logger: (entry: LogEntry) => void = (entry) => console.log(JSON.stringify(entry)),
): Promise<Response> {
  let bindingRequired = false;
  if (!env) {
    try {
      env = (await import("cloudflare:workers")).env as ChatEnv;
      bindingRequired = true;
    } catch {
      env = process.env as ChatEnv;
    } // Explicitly configured local Node development only.
  }
  const requestId = crypto.randomUUID(),
    started = performance.now();
  const transport = env.AI || bindingRequired ? "binding" : "rest";
  const headers = { "Cache-Control": "no-store", "X-Chat-Request-Id": requestId };
  const log = (fields: LogEntry) => {
    // Never log input, arbitrary provider text, tokens, user identity or tool arguments.
    try {
      logger({
        event: "chat_ai",
        request_id: requestId,
        provider: "workers_ai",
        model: CHAT_MODEL,
        transport,
        processing_ms: Math.round(performance.now() - started),
        ...fields,
      });
    } catch {
      /* Logging cannot break chat. */
    }
  };
  const fail = (error: string, status: number, fields: LogEntry) => {
    log({ outcome: "error", ...fields });
    return Response.json({ error }, { status, headers });
  };
  if (env.CLOUDFLARE_AI_ENABLED !== "true")
    return fail("Cloudflare AI is not enabled yet.", 503, { category: "disabled" });
  if (bindingRequired && !env.AI)
    return fail("Cloudflare AI is not configured yet.", 503, { category: "missing_binding" });
  const account = env.CLOUDFLARE_ACCOUNT_ID,
    key = env.CLOUDFLARE_AI_API_TOKEN;
  if (!env.AI && (!account || !/^[a-f0-9]{32}$/.test(account) || !key))
    return fail("Cloudflare AI is not configured yet.", 503, { category: "missing_configuration" });
  let stage = "invocation",
    upstreamStatus: number | null = null;
  const signal = AbortSignal.timeout(25_000);
  try {
    const payload = {
      ...input,
      max_tokens: Math.min(2048, Math.max(1, input.max_tokens ?? 1200)),
      stream: false,
    };
    const grokKey = env.XAI_API_KEY || (process.env as ChatEnv).XAI_API_KEY;
    if (grokKey && input.voice !== "fast" && !input.tools?.length) {
      try {
        const grok = await send("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${grokKey}`, "content-type": "application/json" },
          signal,
          body: JSON.stringify({
            model: GROK_CHAT_MODEL,
            messages: input.messages,
            max_tokens: payload.max_tokens,
            stream: false,
          }),
        });
        if (grok instanceof Response && grok.ok) {
          upstreamStatus = grok.status;
          const data = await boundedJson(grok);
          log({
            outcome: "ok",
            category: "completed",
            provider: "xai",
            model: GROK_CHAT_MODEL,
            upstream_status: grok.status,
          });
          return Response.json({ message: normalizeMessage(data) }, { headers });
        }
      } catch {
        /* Fall through to Workers AI. */
      }
    }
    const response = env.AI
      ? await env.AI.run(
          CHAT_MODEL,
          {
            ...payload,
            ...(input.tools?.length
              ? { tools: input.tools.map((tool) => object(tool).function ?? tool) }
              : {}),
          },
          { returnRawResponse: true, signal },
        )
      : await send(
          `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            signal,
            body: JSON.stringify({ ...payload, model: CHAT_MODEL }),
          },
        );
    stage = "serialization";
    if (!(response instanceof Response)) throw Error("invalid_response");
    upstreamStatus = response.status;
    let data: Json;
    try {
      data = await boundedJson(response);
    } catch (error) {
      if (response.ok) throw error;
      data = {};
    }
    if (!response.ok) {
      const providerErrors = Array.isArray(data.errors) ? data.errors : [];
      const rawCode =
        data.internalCode ?? object(providerErrors[0]).code ?? object(data.error).code;
      const code = typeof rawCode === "number" ? rawCode : null;
      const category =
        code === 5028 || code === 5007 || response.status === 410
          ? "model_unavailable"
          : response.status === 401 || response.status === 403
            ? "provider_authorization"
            : response.status === 429
              ? "rate_limit"
              : response.status === 400 || response.status === 422
                ? "provider_schema"
                : "provider_error";
      const messages: Record<string, string> = {
        model_unavailable: "Configured model is unavailable or retired",
        provider_authorization: "Provider denied authorization",
        rate_limit: "Provider rate or usage limit reached",
        provider_schema: "Provider rejected request schema",
        provider_error: "Provider returned an error",
      };
      return fail(
        response.status === 429
          ? "AI usage limit reached. Please try again later."
          : "Cloudflare AI could not answer. Check its configuration and availability.",
        response.status === 429 ? 429 : 502,
        {
          category,
          upstream_status: response.status,
          provider_code: code,
          provider_message: messages[category]!,
        },
      );
    }
    const message = normalizeMessage(data);
    log({ outcome: "ok", category: "completed", upstream_status: response.status });
    return Response.json({ choices: [{ message }] }, { headers });
  } catch (error) {
    const timedOut = signal.aborted || (error instanceof Error && error.name === "TimeoutError");
    return fail(
      timedOut
        ? "The assistant took too long. Please try again."
        : "The assistant is temporarily unavailable.",
      502,
      {
        category: timedOut
          ? "timeout"
          : stage === "serialization"
            ? "invalid_response"
            : "network_or_binding_error",
        upstream_status: upstreamStatus,
        exception_name:
          error instanceof Error &&
          ["Error", "AiError", "AbortError", "TimeoutError", "TypeError", "SyntaxError"].includes(
            error.name,
          )
            ? error.name
            : "unknown",
      },
    );
  }
}
