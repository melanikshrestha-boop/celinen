/** Uses the request's bearer, not an admin key or the browser SDK's mutable session. */
export async function persistProfileMetadata(
  input: {
    owner: string;
    expectedOwner: string;
    authUrl: string;
    publishableKey: string;
    authorization: string;
    metadata: Record<string, unknown>;
  },
  request: typeof fetch = fetch,
) {
  if (input.owner !== input.expectedOwner)
    throw new Error("Your account changed. Reopen settings before saving.");
  const response = await request(new URL("/auth/v1/user", input.authUrl), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: input.publishableKey,
      Authorization: input.authorization,
    },
    body: JSON.stringify({ data: input.metadata }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error("Your profile could not be saved. Check your sign-in and try again.");
  const user = (await response.json()) as { id?: string };
  if (user.id !== input.owner) throw new Error("The profile response did not match your account.");
}
