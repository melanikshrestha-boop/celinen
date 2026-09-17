import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("money CTAs never reopen a dead checkout; without Stripe they go to Google-auth signup", () => {
  const unpaidAuth = 'search={{ mode: "signup", next: "/studio" }}';
  for (const path of ["src/routes/signup.tsx", "src/components/marketing/PlanCheckout.tsx"]) {
    const source = read(path);
    expect(source).toContain("paymentsAreConfigured");
    expect(source).toContain('to="/auth"');
    expect(source).toContain(unpaidAuth);
    expect(source).not.toContain("WaitlistForm");
  }
  const banner = read("src/components/PaymentTestModeBanner.tsx");
  expect(banner).toContain("if (!clientToken) return null;");
  expect(banner).not.toMatch(/checkout is not configured/i);
  // Pricing never promises paid access while Stripe is off, and only links plans on the grid.
  const pricing = read("src/routes/pricing.tsx");
  expect(pricing).not.toContain("Access starts after payment");
  expect(pricing).not.toContain('plan: "starter"');
  expect(read("src/components/marketing/HomePricing.tsx")).toMatch(
    /PRICING_LEDE = paymentsAreConfigured\(\)\s*\? "[^"]*Access starts after payment/,
  );
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
  // Signup/ambassador footer: no links into the old desk tools.
  expect(read("src/components/lensos/Footer.tsx")).not.toMatch(
    /Event Desk|"\/pick"|"\/metadata"|"\/packages"|Switch from Pixieset/,
  );
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
