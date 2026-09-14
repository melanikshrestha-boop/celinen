/** Server-only transport. Never fall back to the former hosting provider. */
export async function requestCloudflareChat(
  input: { messages: unknown[]; tools?: unknown[]; tool_choice?: string; max_tokens?: number },
  env: Record<string, string | undefined> = process.env,
  send: typeof fetch = fetch,
): Promise<Response> {
  const fail = (error: string, status: number) => Response.json({ error }, { status });
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const key = env.CLOUDFLARE_AI_API_TOKEN;
  if (env.CLOUDFLARE_AI_ENABLED !== "true") return fail("Cloudflare AI is not enabled yet.", 503);
  if (!account || !/^[a-f0-9]{32}$/.test(account) || !key)
    return fail("Cloudflare AI is not configured yet.", 503);
  try {
    const response = await send(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          ...input,
          model: "@cf/meta/llama-3.1-8b-instruct",
          max_tokens: Math.min(2048, Math.max(1, input.max_tokens ?? 1200)),
          stream: false,
        }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return fail(
        response.status === 429
          ? "AI usage limit reached. Please try again later."
          : "Cloudflare AI could not answer. Check its configuration and availability.",
        response.status === 429 ? 429 : 502,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown[] } }>;
    };
    const message = data.choices?.[0]?.message;
    if (
      !message ||
      (!(typeof message.content === "string" && message.content.trim()) &&
        !message.tool_calls?.length)
    )
      return fail("The assistant returned no reply.", 502);
    return Response.json({ choices: [{ message }] });
  } catch (error) {
    return fail(
      error instanceof Error && error.name === "TimeoutError"
        ? "The assistant took too long. Please try again."
        : "The assistant is temporarily unavailable.",
      502,
    );
  }
}
