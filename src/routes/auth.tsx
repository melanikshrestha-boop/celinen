import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { AuthScreen } from "@/components/account/AuthScreen";
import { parseAuthSearch } from "@/lib/auth-flow";
import { safeSignInPath } from "@/lib/workbench";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Your LensLabs account" },
      {
        name: "description",
        content:
          "Sign in or create your LensLabs account. Your shoots, galleries, and storefronts in one place.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: parseAuthSearch,
  component: AuthPage,
});

function AuthPage() {
  const account = useAccount();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const destination = safeSignInPath(search.next);
  useEffect(() => {
    if (account?.status === "in") void navigate({ href: destination, replace: true });
  }, [account?.status, navigate, destination]);
  return (
    <AuthScreen
      key={JSON.stringify(search)}
      {...search}
      onAuthenticated={() => {
        void navigate({ href: destination, replace: true });
      }}
    />
  );
}
