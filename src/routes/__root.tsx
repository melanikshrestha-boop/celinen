import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportAppError } from "../lib/app-error-reporting";
import { PRODUCT_HEADLINE } from "@/lib/product";
import { LensProvider } from "@/lib/lensos-store";
import { WorkbenchBoundary } from "@/components/workbench/Workbench";
import { AccountProvider, useAccount } from "@/components/account/AccountProvider";
import { ProductAnalytics } from "@/components/account/ProductAnalytics";

function NotFoundComponent() {
  return (
    <div className="celinen-status">
      <h1>404</h1>
      <p>Page not found</p>
      <Link to="/" className="celinen-btn">
        Go home
      </Link>
    </div>
  );
}

function ErrorComponent({ error }: { error: Error; reset: () => void }) {
  console.error(error);
  useEffect(() => {
    reportAppError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  // Soft reset() keeps a dead HMR module on screen. A missing-identifier crash
  // (the dashboard LayoutTemplate miss) only recovers on a full reload.
  useEffect(() => {
    if (!(error instanceof ReferenceError) && !/ is not defined$/.test(error.message)) return;
    const key = `celinen.reload-once:${error.message}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    window.location.reload();
  }, [error]);

  return (
    <div className="celinen-status">
      <h1>This page didn’t load</h1>
      <div className="celinen-status__actions">
        <button
          type="button"
          className="celinen-btn"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
        <a href="/" className="celinen-btn celinen-btn--ghost">
          Go home
        </a>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: PRODUCT_HEADLINE },
      {
        name: "description",
        content:
          "Celinen scores, flags and culls a full RAW shoot in your browser, then develops the keepers.",
      },
      { property: "og:title", content: PRODUCT_HEADLINE },
      {
        property: "og:description",
        content: "Cull 300 shots in minutes. Local RAW culling, ranking and basic develop tools.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "preload",
        href: "/fonts/source-serif-4/SourceSerif4Variable-Roman.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AccountProvider>
        <AccountContent />
      </AccountProvider>
    </QueryClientProvider>
  );
}

function AccountContent() {
  const account = useAccount();
  return (
    <LensProvider key={account?.scope ?? "signed-out"}>
      <ProductAnalytics />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <WorkbenchBoundary>
        <Outlet />
      </WorkbenchBoundary>
    </LensProvider>
  );
}
