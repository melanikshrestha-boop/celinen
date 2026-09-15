import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("money CTAs wait for live Stripe instead of a dead checkout", () => {
  const signup = read("src/routes/signup.tsx");
  expect(signup).toContain("WaitlistForm");
  expect(signup).toContain("paymentsAreConfigured");
  expect(read("src/components/marketing/WaitlistForm.tsx")).toContain("Join waitlist");
  expect(read("src/components/marketing/WaitlistForm.tsx")).toContain("PRODUCT_EMAIL");
  expect(read("src/lib/product.ts")).toContain('PRODUCT_EMAIL = "hello@lenslab.dev"');
});

test("/features redirects to the existing product page", () => {
  const source = read("src/routes/features.tsx");
  expect(source).toContain('createFileRoute("/features")');
  expect(source).toContain('redirect({ to: "/product" })');
});

test("public brand is Celinen, not FOTO/LensLabs/IRIS leftovers", () => {
  expect(read("src/routes/signup.tsx")).not.toContain("LensLabs");
  expect(read("src/routes/signup.tsx")).not.toContain("tryiris");
  expect(read("src/routes/privacy.tsx")).toContain("Celinen");
  expect(read("src/routes/privacy.tsx")).not.toContain("FOTO");
  expect(read("src/routes/terms.tsx")).toContain("Celinen");
  expect(read("src/routes/terms.tsx")).not.toContain("FOTO");
  expect(read("src/routes/security.tsx")).toContain("Celinen");
  expect(read("src/components/account/SettingsGuide.tsx")).toContain("hello@lenslab.dev");
  expect(read("src/components/account/SettingsGuide.tsx")).not.toContain(
    "A public security contact and security disclosures have not been configured",
  );
  expect(read("src/components/lensos/Footer.tsx")).toContain("hello@lenslab.dev");
  expect(read("src/components/lensos/Footer.tsx")).not.toContain("tryiris");
  expect(read("src/components/marketing/BlogIndex.tsx")).toContain("PRODUCT_NAME");
  expect(read("src/components/marketing/BlogIndex.tsx")).not.toMatch(/>foto</);
});

test("Sign In does not auto-start Google, and OAuth return does not re-open the chooser", () => {
  expect(read("src/components/Nav.tsx")).not.toContain("google: true");
  const auth = read("src/components/account/AuthScreen.tsx");
  expect(auth).toContain('params.has("code")');
  expect(auth).toContain("Hobby · USD 16");
  expect(auth).not.toContain("Pablo Picasso");
});

test("mobile marketing nav hides the desktop links and dismisses overlays on breakpoint change", () => {
  const css = read("src/components/marketing/public-details.css");
  expect(css).toContain("@media (max-width: 900px)");
  expect(css).toMatch(/\.marketing-page \.marketing-nav__links \{\s*display: none;/);
  expect(read("src/components/marketing/nav-menu.tsx")).toContain('matchMedia("(max-width: 900px)")');
  expect(read("src/components/marketing/FeaturesMenu.tsx")).toContain("modal={false}");
});
