// Run with gstack browse eval on the REAL localhost /auth page, not as a file tab.
// Only synthetic input is used. All auth requests are intercepted in this test tab;
// no accounts are created, messages sent, real sessions changed, or tokens stored.
if (location.origin !== "http://localhost:8080" || location.pathname !== "/auth") {
  throw new Error("Run only against the local LensLabs auth page.");
}
if (!document.querySelector(".auth-screen")) throw new Error("Expected signed-out auth screen.");
const checks = [];
const requests = [];
const originalFetch = window.fetch;
let responseKind = "invalid";
let release;
const assert = (value, name) => {
  if (!value) throw new Error(name);
  checks.push(name);
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
const waitFor = async (condition) => {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await pause();
  }
  throw new Error("Timed out waiting for form state");
};
const fill = async (id, value) => {
  const input = document.getElementById(id);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await pause();
};
const submit = () =>
  document
    .querySelector("form.auth-form")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const switchMode = async () => {
  document.querySelector(".auth-switch a").click();
  await waitFor(() => !document.querySelector(".auth-form fieldset").disabled);
  await pause();
};
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? input.toString()));
  if (!url.pathname.startsWith("/auth/v1/")) return originalFetch(input, init);
  // Never record a password, key, token, or raw request body.
  const body = JSON.parse(init?.body || "{}");
  requests.push({
    path: url.pathname,
    redirect: url.searchParams.get("redirect_to"),
    hasName: body.data?.full_name === "Pablo QA",
    createUser: body.create_user,
  });
  if (responseKind === "pending")
    await new Promise((resolve) => {
      release = resolve;
    });
  const data =
    responseKind === "confirmation"
      ? {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          aud: "authenticated",
          email: "lenslabs-qa@example.invalid",
          created_at: "2026-09-07T00:00:00Z",
        }
      : responseKind === "otp"
        ? {}
        : { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" };
  return new Response(JSON.stringify(data), {
    status: responseKind === "confirmation" || responseKind === "otp" ? 200 : 400,
    headers: { "content-type": "application/json" },
  });
};
try {
  assert(
    document.querySelector("h1").textContent === "Create Your Account",
    "New visit starts with Create Your Account",
  );
  assert(
    document.querySelector("#auth-name").value === "",
    "Artist name is a placeholder, not account data",
  );
  assert(document.querySelector("#auth-email").value === "", "Example email is not prefilled");
  assert(
    document.querySelector("#auth-name").placeholder === "Pablo Picasso",
    "Exact artist-name example",
  );
  assert(
    document.querySelector("#auth-email").placeholder === "picasso@gmail.com",
    "Exact requested email example",
  );
  assert(
    document.querySelector("#auth-password").placeholder === "At least 8 characters",
    "Exact password placeholder",
  );
  assert(!document.querySelector(".auth-magic"), "Signup has no competing magic-link action");
  assert(
    getComputedStyle(document.querySelector(".auth-submit")).backgroundImage === "none",
    "Primary CTA has flat ivory color, not a gradient",
  );
  const aligned = [
    ".auth-google",
    "#auth-name",
    "#auth-email",
    "#auth-password",
    ".auth-submit",
    ".auth-assurance",
  ].map((selector) => document.querySelector(selector).getBoundingClientRect());
  assert(
    aligned.every(
      (rect) =>
        Math.abs(rect.left - aligned[0].left) < 0.5 &&
        Math.abs(rect.right - aligned[0].right) < 0.5,
    ),
    "All controls and trust row share exact edges",
  );
  if (innerWidth >= 1024 && getComputedStyle(document.documentElement).fontSize === "16px") {
    const panel = document.querySelector(".auth-panel").getBoundingClientRect();
    assert(panel.width >= 460 && panel.width <= 500, "Desktop card width matches 460–500px target");
    assert(
      panel.height >= 680 && panel.height <= 760,
      "Desktop card height matches 680–760px target",
    );
    assert(
      aligned.slice(1, 4).every((rect) => rect.height >= 44 && rect.height <= 46),
      "Inputs match 44–46px target",
    );
    assert(
      [aligned[0], aligned[4]].every((rect) => rect.height >= 46 && rect.height <= 48),
      "Google and primary buttons match 46–48px target",
    );
    assert(aligned[5].height >= 72 && aligned[5].height <= 82, "Trust row matches 72–82px target");
  }
  assert(
    document.querySelector("#auth-password").type === "password",
    "Password is hidden initially",
  );
  assert(
    document.querySelector("#auth-password").autocomplete === "new-password",
    "Signup supports password managers",
  );
  submit();
  await pause();
  assert(requests.length === 0, "Empty submit sends no auth request");
  await fill("auth-name", "Pablo QA");
  await fill("auth-email", "not-an-email");
  submit();
  await pause();
  assert(requests.length === 0, "Invalid signup email sends no request");
  await fill("auth-email", "lenslabs-qa@example.invalid");
  await fill("auth-password", "synthetic-test-password");
  document.querySelector(".auth-password button").click();
  await pause();
  assert(document.querySelector("#auth-password").type === "text", "Password reveal works");
  assert(
    document.querySelector(".auth-password button").getAttribute("aria-label") === "Hide password",
    "Password toggle has an accessible state",
  );
  responseKind = "pending";
  submit();
  submit();
  await waitFor(() => requests.length === 1);
  assert(requests.length === 1, "Same-turn duplicate submits produce one request");
  assert(
    document.querySelector(".auth-form fieldset").disabled,
    "Fields are locked during submission",
  );
  assert(
    document.querySelector(".auth-google").disabled,
    "Google is locked during email submission",
  );
  assert(
    !document.querySelector(".auth-magic"),
    "Signup does not add another action during submission",
  );
  const urlDuringRequest = location.href;
  document.querySelector(".auth-switch a").click();
  await pause();
  assert(location.href === urlDuringRequest, "Mode cannot change during an account mutation");
  responseKind = "confirmation";
  release();
  await waitFor(() => document.querySelector("[role=status]"));
  assert(requests[0].path.endsWith("/signup"), "Signup calls the actual Supabase signup client");
  assert(requests[0].hasName, "Signup carries the entered profile name");
  assert(
    new URL(requests[0].redirect).pathname === "/auth",
    "Email confirmation returns through account entry",
  );
  assert(
    new URL(requests[0].redirect).searchParams.get("next") === "/workspace",
    "Confirmation preserves the workspace destination",
  );
  assert(location.pathname === "/auth", "Unconfirmed signup does not open a workspace");
  assert(
    document.querySelector("#auth-password").value === "",
    "Signup confirmation clears the password",
  );
  assert(
    document.querySelector("#auth-password").type === "password",
    "Signup confirmation resets password reveal",
  );
  assert(
    !document.querySelector(".auth-form fieldset").disabled,
    "Form unlocks after confirmation response",
  );
  await switchMode();
  assert(!document.querySelector("#auth-name"), "Sign-in removes signup-only fields");
  assert(
    document.querySelector(".auth-magic"),
    "Existing sign-in keeps its passwordless recovery option",
  );
  assert(
    document.querySelector("#auth-password").autocomplete === "current-password",
    "Sign-in supports saved credentials",
  );
  assert(!document.querySelector("[role=status]"), "Switching modes clears stale success messages");
  assert(
    new URL(location.href).searchParams.get("next") === "/workspace",
    "Switching modes preserves the next destination",
  );
  await fill("auth-email", "not-an-email");
  const beforeInvalidEmail = requests.length;
  document.querySelector(".auth-magic").click();
  await pause();
  assert(
    requests.length === beforeInvalidEmail,
    "Sign-in magic link validates the email before sending",
  );
  await fill("auth-email", "lenslabs-qa@example.invalid");
  await fill("auth-password", "short");
  responseKind = "invalid";
  submit();
  await waitFor(() => document.querySelector("[role=alert]"));
  assert(
    requests.at(-1).path.endsWith("/token"),
    "Existing passwords under eight characters reach the provider",
  );
  assert(
    document.querySelector("[role=alert]").textContent.includes("don’t match"),
    "Invalid credentials show an actionable error",
  );
  assert(
    !document.querySelector(".auth-form fieldset").disabled,
    "Invalid credentials allow another attempt",
  );
  await fill("auth-password", "");
  responseKind = "otp";
  document.querySelector(".auth-magic").click();
  await waitFor(() => document.querySelector("[role=status]"));
  assert(requests.at(-1).path.endsWith("/otp"), "Email sign-in link works without a password");
  assert(requests.at(-1).createUser === false, "Sign-in link does not silently create an account");
  assert(!document.querySelector("[role=alert]"), "Retry clears the prior error");
  const requestsBeforeGoogle = requests.length;
  document.querySelector(".auth-google").click();
  await pause();
  assert(
    requests.length === requestsBeforeGoogle,
    "Local Google never calls the missing broker route",
  );
  assert(location.pathname === "/auth", "Local Google does not strand the visitor on a 404");
  assert(
    new URL(document.querySelector(".auth-live-link").href).origin === "https://lenslab.dev",
    "Local Google offers the hosted sign-in flow",
  );
  assert(
    !document.querySelector("[role=status]"),
    "Google attempt clears stale email confirmation",
  );
  assert(
    document.querySelector(".auth-footer a").getAttribute("href") === "/portal",
    "Client access uses the real portal route",
  );
  assert(
    document.querySelector(".auth-brand").getAttribute("href") === "/",
    "Logo returns to the public homepage",
  );
  assert(document.documentElement.scrollWidth <= innerWidth, "Auth has no horizontal overflow");
  await switchMode();
  assert(document.querySelector("#auth-password").value === "", "Returning to signup starts clean");
  return {
    passed: checks.length,
    checks,
    mockedProviderRequests: requests.length,
    liveAccountsCreated: 0,
    emailsSent: 0,
  };
} finally {
  window.fetch = originalFetch;
}
